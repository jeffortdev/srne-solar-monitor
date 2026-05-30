import { Component, OnInit } from '@angular/core';
import { SettingsService } from './services/settings.service';
import { HistoryService } from './services/history.service';
import { SrneDataService } from './services/srne-data.service';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  standalone: false,
})
export class AppComponent implements OnInit {

  constructor(
    private settings: SettingsService,
    private history: HistoryService,
    private srne: SrneDataService
  ) {}

  async ngOnInit(): Promise<void> {
    await Promise.all([
      this.settings.load(),
      this.history.load()
    ]);
    this.srne.startPolling();
  }
}

