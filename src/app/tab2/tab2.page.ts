import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild } from '@angular/core';
import { Share } from '@capacitor/share';
import { Chart, ChartConfiguration, registerables } from 'chart.js';
import { HistoryService } from '../services/history.service';

Chart.register(...registerables);

interface DatasetConfig {
  label: string;
  color: string;
  visible: boolean;
  key: 'solarPower' | 'loadPower' | 'batterySoc' | 'batteryVoltage';
}

@Component({
  selector: 'app-tab2',
  templateUrl: 'tab2.page.html',
  styleUrls: ['tab2.page.scss'],
  standalone: false,
})
export class Tab2Page implements AfterViewInit, OnDestroy {

  @ViewChild('chartCanvas') chartCanvas!: ElementRef<HTMLCanvasElement>;

  selectedRange: 'today' | '7d' | '30d' = 'today';
  noData = false;

  datasets: DatasetConfig[] = [
    { label: 'Solar (W)',   color: '#f4a825', visible: true,  key: 'solarPower'     },
    { label: 'Load (W)',    color: '#3dc2ff', visible: true,  key: 'loadPower'      },
    { label: 'SOC (%)',     color: '#2dd36f', visible: false, key: 'batterySoc'     },
    { label: 'Batt V',     color: '#a0a0ff', visible: false, key: 'batteryVoltage' }
  ];

  private chart?: Chart;

  constructor(private history: HistoryService) {}

  ngAfterViewInit(): void {
    this.buildChart();
  }

  ionViewWillEnter(): void {
    this.refreshChart();
  }

  ngOnDestroy(): void {
    this.chart?.destroy();
  }

  onRangeChange(): void {
    this.refreshChart();
  }

  toggleDataset(ds: DatasetConfig): void {
    ds.visible = !ds.visible;
    this.refreshChart();
  }

  get chartAriaLabel(): string {
    const visibleLabels = this.datasets.filter(d => d.visible).map(d => d.label).join(', ');
    return `Bar chart showing ${visibleLabels} for ${this.selectedRange}`;
  }

  private buildChart(): void {
    if (!this.chartCanvas?.nativeElement) return;
    const ctx = this.chartCanvas.nativeElement.getContext('2d');
    if (!ctx) return;

    const { labels, chartDatasets } = this.getChartData();

    const config: ChartConfiguration = {
      type: 'bar',
      data: { labels, datasets: chartDatasets },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        animation: { duration: 400 },
        scales: {
          x: {
            ticks: { color: '#a0a0a0', font: { size: 10 } },
            grid: { color: '#ffffff10' }
          },
          y: {
            ticks: { color: '#a0a0a0', font: { size: 10 } },
            grid: { color: '#ffffff10' },
            beginAtZero: true
          }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#16213e',
            titleColor: '#f4a825',
            bodyColor: '#e8e8e8',
            borderColor: '#f4a82550',
            borderWidth: 1
          }
        }
      }
    };

    this.chart = new Chart(ctx, config);
    this.noData = labels.length === 0;
  }

  private refreshChart(): void {
    if (!this.chart) {
      this.buildChart();
      return;
    }
    const { labels, chartDatasets } = this.getChartData();
    this.chart.data.labels = labels;
    this.chart.data.datasets = chartDatasets;
    this.chart.update('active');
    this.noData = labels.length === 0;
  }

  private getChartData(): { labels: string[]; chartDatasets: any[] } {
    const visibleKeys = this.datasets.filter(d => d.visible);
    if (!visibleKeys.length) return { labels: [], chartDatasets: [] };

    if (this.selectedRange === 'today') {
      const hourly = this.history.getTodayHourly();
      const labels = hourly.map(h => `${h.hour}:00`);
      const chartDatasets = visibleKeys.map(ds => ({
        label: ds.label,
        data: hourly.map(h => {
          if (ds.key === 'solarPower') return h.avgSolar;
          if (ds.key === 'loadPower')  return h.avgLoad;
          if (ds.key === 'batterySoc') return h.avgSoc;
          return 0;
        }),
        backgroundColor: ds.color + 'bb',
        borderColor: ds.color,
        borderWidth: 1.5,
        borderRadius: 4
      }));
      return { labels, chartDatasets };
    }

    const days = this.selectedRange === '7d' ? 7 : 30;
    const agg = this.history.getDailyAggregates(days);
    const labels = agg.map(a => a.date);
    const chartDatasets = visibleKeys.map(ds => ({
      label: ds.label,
      data: agg.map(a => {
        if (ds.key === 'solarPower') return a.totalSolar;
        if (ds.key === 'loadPower')  return a.totalLoad;
        return 0;
      }),
      backgroundColor: ds.color + 'bb',
      borderColor: ds.color,
      borderWidth: 1.5,
      borderRadius: 4
    }));
    return { labels, chartDatasets };
  }

  async shareChart(): Promise<void> {
    if (!this.chartCanvas?.nativeElement) return;
    const dataUrl = this.chartCanvas.nativeElement.toDataURL('image/png');
    await Share.share({
      title: 'SRNE Solar Report',
      text: `Solar report — ${this.selectedRange}`,
      url: dataUrl,
      dialogTitle: 'Share solar chart'
    }).catch(() => {/* desktop silently fails */});
  }
}

