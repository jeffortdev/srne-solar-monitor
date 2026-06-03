import { Injectable, OnDestroy } from '@angular/core';
import { LocalNotifications, PermissionStatus } from '@capacitor/local-notifications';
import { Subscription } from 'rxjs';
import { ConnectionStatus, SrneDataService } from './srne-data.service';

const NOTIF_ID_SOLAR_DEFICIT = 1001;
/** Minimum gap between repeat notifications for the same ongoing deficit (10 minutes). */
const COOLDOWN_MS = 10 * 60 * 1000;

/**
 * NotificationService — monitors live solar vs load data and fires a local
 * notification whenever solar generation is insufficient to cover the load.
 *
 * Behaviour:
 *  - Fires once when the deficit condition first appears.
 *  - If the deficit persists, repeats every COOLDOWN_MS.
 *  - Resets when solar >= load so the next deficit immediately re-fires.
 *  - Only fires during 'live' status (never in demo or error mode).
 */
@Injectable({ providedIn: 'root' })
export class NotificationService implements OnDestroy {

  private subs = new Subscription();
  private lastNotifAt = 0;
  private inDeficit = false;
  private currentStatus: ConnectionStatus = 'demo';

  constructor(private srne: SrneDataService) {}

  /** Call once from AppComponent.ngOnInit after settings are loaded. */
  async init(): Promise<void> {
    await this.requestPermissions();

    this.subs.add(this.srne.status$.subscribe(s => this.currentStatus = s));
    this.subs.add(this.srne.data$.subscribe(data => {
      if (!data || this.currentStatus !== 'live') return;
      this.evaluateDeficit(data.solarPanelPower, data.loadPower, data.loadStatus);
    }));
  }

  private async requestPermissions(): Promise<void> {
    try {
      const status: PermissionStatus = await LocalNotifications.requestPermissions();
      if (status.display !== 'granted') {
        console.warn('[Notifications] Permission not granted:', status.display);
      }
    } catch (e) {
      // Plugin not available on web — ignore gracefully
      console.warn('[Notifications] requestPermissions unavailable:', e);
    }
  }

  private async evaluateDeficit(solarW: number, loadW: number, loadStatus: number): Promise<void> {
    // Only consider it a deficit when the load output is on and consuming power
    if (loadStatus !== 1 || loadW <= 5) {
      this.inDeficit = false;
      return;
    }

    const deficit = solarW < loadW;
    const now = Date.now();

    if (deficit) {
      if (!this.inDeficit) this.inDeficit = true;
      // Fire notification on first entry OR after cooldown expires (periodic reminder)
      if (now - this.lastNotifAt >= COOLDOWN_MS) {
        this.lastNotifAt = now;
        await this.fireDeficitNotification(solarW, loadW);
      }
    } else {
      // Solar has recovered — reset so the next deficit triggers immediately
      this.inDeficit = false;
    }
  }

  private async fireDeficitNotification(solarW: number, loadW: number): Promise<void> {
    try {
      await LocalNotifications.schedule({
        notifications: [{
          id: NOTIF_ID_SOLAR_DEFICIT,
          title: '☀️ Solar Deficit',
          body: `Solar ${solarW}W < Load ${loadW}W — battery may be draining.`,
          schedule: { at: new Date(Date.now() + 300) },
        }]
      });
    } catch (e) {
      console.warn('[Notifications] schedule failed:', e);
    }
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
  }
}
