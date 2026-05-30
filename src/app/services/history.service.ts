import { Injectable } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import { HistorySnapshot } from '../models/srne.models';

const HISTORY_KEY = 'srne_history';
const MAX_DAYS = 7;
const MAX_ENTRIES = MAX_DAYS * 24 * 60; // 7 days of per-minute data

@Injectable({ providedIn: 'root' })
export class HistoryService {

  private _snapshots: HistorySnapshot[] = [];

  async load(): Promise<void> {
    const result = await Preferences.get({ key: HISTORY_KEY });
    this._snapshots = result.value ? JSON.parse(result.value) : [];
    this.prune();
  }

  async addSnapshot(snap: HistorySnapshot): Promise<void> {
    this._snapshots.push(snap);
    this.prune();
    await this.persist();
  }

  /** Returns snapshots for a date range (inclusive). */
  getRange(fromMs: number, toMs: number): HistorySnapshot[] {
    return this._snapshots.filter(s => s.timestamp >= fromMs && s.timestamp <= toMs);
  }

  /** Returns hourly averaged snapshots for today. */
  getTodayHourly(): { hour: number; avgSolar: number; avgLoad: number; avgSoc: number }[] {
    const now = new Date();
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const dayEnd = dayStart + 86_400_000;
    const todaySnaps = this.getRange(dayStart, dayEnd);

    const hours: Map<number, HistorySnapshot[]> = new Map();
    for (const s of todaySnaps) {
      const h = new Date(s.timestamp).getHours();
      if (!hours.has(h)) hours.set(h, []);
      hours.get(h)!.push(s);
    }

    const result = [];
    for (const [h, snaps] of hours) {
      result.push({
        hour: h,
        avgSolar: avg(snaps.map(s => s.solarPower)),
        avgLoad: avg(snaps.map(s => s.loadPower)),
        avgSoc: avg(snaps.map(s => s.batterySoc))
      });
    }
    return result.sort((a, b) => a.hour - b.hour);
  }

  /** Returns daily aggregates for a given number of past days. */
  getDailyAggregates(days: number): { date: string; totalSolar: number; totalLoad: number }[] {
    const now = Date.now();
    const results = [];
    for (let d = days - 1; d >= 0; d--) {
      const dayStart = new Date(now - d * 86_400_000);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = dayStart.getTime() + 86_400_000;
      const snaps = this.getRange(dayStart.getTime(), dayEnd);
      results.push({
        date: dayStart.toLocaleDateString('en-AU', { month: 'short', day: 'numeric' }),
        totalSolar: snaps.length ? snaps[snaps.length - 1].dailyGenerated : 0,
        totalLoad: snaps.length ? snaps[snaps.length - 1].dailyConsumed : 0
      });
    }
    return results;
  }

  private prune(): void {
    if (this._snapshots.length > MAX_ENTRIES) {
      this._snapshots = this._snapshots.slice(-MAX_ENTRIES);
    }
    const cutoff = Date.now() - MAX_DAYS * 86_400_000;
    this._snapshots = this._snapshots.filter(s => s.timestamp >= cutoff);
  }

  private async persist(): Promise<void> {
    await Preferences.set({ key: HISTORY_KEY, value: JSON.stringify(this._snapshots) });
  }
}

function avg(values: number[]): number {
  if (!values.length) return 0;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}
