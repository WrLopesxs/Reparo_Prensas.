const ToyotaQC = (function() {
  'use strict';

  // ==================== CONFIGURAÇÕES ====================
  const CONFIG = {
    SHEET_ID: '1y8kcWOCFCXeHHtC_MFHBD2M5zYasY6A8K4MW_Qqo3V0',
    GID: '914910661',
    UPDATE_INTERVAL: 600,
    CACHE_TIME: 300000,
    TOP_PNS: 15,
    MANUAL_COOLDOWN: 60,
    SHEET_OPEN_URL: 'https://docs.google.com/spreadsheets/d/1y8kcWOCFCXeHHtC_MFHBD2M5zYasY6A8K4MW_Qqo3V0/edit?gid=914910661#gid=914910661',
    VERSION: 'v1.7.0',
    // Limite para área do reparo
    AREA_LIMIT: 84, // m²
    
    // Limites para alerta de "explosão"
    SPIKE_THRESHOLD: 1.5, // 50% de aumento
    
    // Configurações de backup
    BACKUP_FOLDER: 'ToyotaQC_Backups', // Nome da pasta para backups
    MAX_BACKUPS: 10, // Máximo de backups para manter
    MAX_CACHED_BACKUPS: 3 // Máximo de backups completos em cache (os mais recentes)
  };

  const COL = Object.freeze({
    data: 'Data Produção',
    turno: 'Turno',
    die: 'Die Number',
    part: 'Part Number',
    qtdCheck: 'Qtd p/checar',
    tipoDef: 'Tipo de Defeito',

    chec1: 'Checado 1°T',
    rep1: 'Reparado 1°T',
    scr1: 'Scrap 1°T',
    who1: 'Quem Reparou? 1ºT',

    chec2: 'Checado 2°T',
    rep2: 'Reparado 2°T',
    scr2: 'Scrap 2°T',
    who2: 'Quem Reparou? 2ºT',

    chec3: 'Checado 3°T',
    rep3: 'Reparado 3°T',
    scr3: 'Scrap 3°T',
    who3: 'Quem Reparou? 3ºT',

    scrapTotal: 'Qtde Scrap',
    dataSaida: 'Data Saída Reparo',
    saldo: 'Saldo',
    saldoDef: 'Saldo Defeito',
    status: 'Status',

    // ÁREA REPARO
    areaPallet: 'Area Pallet',
    empilhaMax: 'Quantidade Empilha',
    pecasPorPallet: 'Quantidade Pallet',
    areaReparo: 'Area Reparo'
  });

  // ==================== ESTADO GLOBAL ====================
  const State = {
    data: [],
    currentFilter: null,
    currentDefectKey: null,
    lastFilteredData: [],
    checkedFilter: { day: '', month: '', year: '' },
    
    quickFilters: {
      search: '',
      saldo: false,
      saldoDef: false,
      scrap: false,
      sort: ''
    },
    
    previousStats: null,
    
    currentScreen: 'menu',
    isDarkMode: false,
    timer: CONFIG.UPDATE_INTERVAL,
    manualCooldownLeft: 0,
    isFetching: false,
    intervalRef: null,
    
    connectionStatus: 'online',
    lastUpdateTimestamp: null,
    
    tablePager: {
      pageSize: parseInt(localStorage.getItem('toyota_pageSize')) || 100,
      page: 1,
      totalPages: 1,
      totalRows: 0
    },
    
    alerts: {
      area: false,
      spike: null
    },
    
    // Estado para controle dos cards na página inicial
    menuCards: {
      areaExpanded: true,      // Card da área começa expandido
      comparativeExpanded: true // Card comparativo começa expandido
    },
    
    // Armazenar dados detalhados da área
    areaDetails: {
      total: 0,
      items: [],
      lastUpdate: null
    },
    
    // Configuração do gráfico comparativo
    comparativeChart: {
      view: 'monthly', // 'monthly' ou 'yearly'
      year: new Date().getFullYear()
    },
    
    charts: {
      pareto: null,
      status: null,
      defectByPN: null,
      missingCheck: null,
      areaChart: null,
      comparativeChart: null
    },
    
    // Estado para backups
    backups: {
      list: [],
      isRestoring: false
    }
  };

  // ==================== UTILITÁRIOS ====================
  const Utils = {
    int: (v) => {
      if (v === null || v === undefined) return 0;
      const s = String(v).trim();
      if (!s) return 0;
      const cleaned = s.replace(/\./g, '').replace(/,/g, '.').replace(/[^\d.-]/g, '');
      const n = parseFloat(cleaned);
      return Number.isFinite(n) ? Math.trunc(n) : 0;
    },
    
    float: (v) => {
      if (v === null || v === undefined) return 0;
      const s = String(v).trim().replace(',', '.');
      const n = parseFloat(s);
      return Number.isFinite(n) ? n : 0;
    },
    
    txt: (v) => (v === null || v === undefined || String(v).trim() === '') ? '-' : String(v),
    normalizePN: (v) => String(v || '').trim().toUpperCase(),
    normalizeDefect: (name) => String(name || '-').trim().replace(/\s+/g, ' ').toUpperCase(),

    parseDateBR: (value) => {
      const s = String(value || '').trim();
      if (!s) return null;
      const m = s.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
      if (!m) return null;
      let dd = parseInt(m[1], 10);
      let mm = parseInt(m[2], 10);
      let yy = parseInt(m[3], 10);
      if (yy < 100) yy = 2000 + yy;
      const d = new Date(yy, mm - 1, dd);
      return isNaN(d.getTime()) ? null : d;
    },
    
    formatDateShort: (d) => {
      if (!d) return '—';
      const dd = String(d.getDate()).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const yy = String(d.getFullYear()).slice(-2);
      return `${dd}/${mm}/${yy}`;
    },
    
    formatDateFull: (d) => {
      if (!d) return '—';
      const dd = String(d.getDate()).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const yyyy = d.getFullYear();
      const hh = String(d.getHours()).padStart(2, '0');
      const min = String(d.getMinutes()).padStart(2, '0');
      return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
    },
    
    formatDateFromTs: (ts) => {
      if (ts === null || ts === undefined) return '—';
      const d = new Date(ts);
      return isNaN(d.getTime()) ? '—' : Utils.formatDateShort(d);
    },
    
    pad2: (n) => String(n).padStart(2, '0'),

    debounce: (func, wait) => {
      let timeout;
      return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func(...args), wait);
      };
    },

    fetchWithRetry: async (url, retries = 3) => {
      for (let i = 0; i < retries; i++) {
        try {
          const response = await fetch(url, { cache: 'no-store' });
          if (response.ok) return response;
          if (i === retries - 1) throw new Error(`HTTP ${response.status}`);
        } catch (err) {
          if (i === retries - 1) throw err;
          await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i)));
        }
      }
    },

    showToast: (message, type = 'info', duration = 3000) => {
      const toast = document.createElement('div');
      toast.className = `toast ${type}`;
      toast.textContent = message;
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), duration);
    },

    showSkeleton: (elementId, rows = 5, cols = 24) => {
      const element = document.getElementById(elementId);
      if (!element) return;
      element.innerHTML = Array(rows).fill(0).map(() => `
        <tr class="skeleton">
          <td colspan="${cols}" class="px-4 py-3">
            <div class="h-4 bg-gray-200 dark:bg-gray-700 rounded w-full"></div>
          </td>
        </tr>
      `).join('');
    },

    checkScreenSize: () => {
      if (window.innerWidth < 1280) document.body.classList.add('compact-mode');
      else document.body.classList.remove('compact-mode');
      
      if (window.innerWidth > 1920) document.body.classList.add('tv-mode');
      else document.body.classList.remove('tv-mode');
    },
    
    formatNumber: (num) => {
      return Number(num || 0).toLocaleString('pt-BR');
    },
    
    calculatePercentage: (part, total) => {
      if (!total || total === 0) return 0;
      return Math.round((part / total) * 100 * 10) / 10;
    },
    
    detectSpike: (current, previous, field) => {
      if (!previous || !previous[field]) return false;
      const prevVal = previous[field] || 0;
      const currVal = current[field] || 0;
      if (prevVal === 0) return currVal > 0;
      return currVal / prevVal > CONFIG.SPIKE_THRESHOLD;
    },
    
    // Gerar nome de arquivo para backup
    generateBackupFileName: () => {
      const now = new Date();
      const date = `${now.getFullYear()}${Utils.pad2(now.getMonth()+1)}${Utils.pad2(now.getDate())}`;
      const time = `${Utils.pad2(now.getHours())}${Utils.pad2(now.getMinutes())}${Utils.pad2(now.getSeconds())}`;
      return `ToyotaQC_Backup_${date}_${time}.json`;
    },
    
    // Salvar arquivo no computador
    downloadFile: (content, fileName, mimeType = 'application/json') => {
      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
    
    // Carregar arquivo do computador
    loadFile: (callback, accept = '.json') => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = (event) => {
          callback(event.target.result, file.name);
        };
        reader.readAsText(file);
      };
      input.click();
    },
    
    // Formatar tamanho do arquivo
    formatFileSize: (bytes) => {
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
      return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    },
    
    // Obter nome do mês
    getMonthName: (month) => {
      const months = [
        'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
        'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
      ];
      return months[month - 1] || month;
    }
  };

  // ==================== GRÁFICOS ====================
  const Charts = {
    register: () => {
      if (window.ChartDataLabels) {
        Chart.register(ChartDataLabels);
      }
    },

    getTextColor: () => (document.documentElement.classList.contains('dark') ? '#E5E7EB' : '#1F2937'),
    getGridColor: () => (document.documentElement.classList.contains('dark') ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'),

    baseConfig: {
      responsive: true,
      maintainAspectRatio: false,
      layout: {
        padding: {
          top: 20,
          bottom: 20,
          left: 10,
          right: 30
        }
      },
      plugins: {
        legend: {
          labels: {
            font: { family: 'Inter', size: 11, weight: '600' },
            color: () => Charts.getTextColor(),
            usePointStyle: true,
            pointStyle: 'circle',
            padding: 15
          }
        },
        datalabels: {
          display: true,
          color: (context) => {
            if (context.dataset.type === 'line') return Charts.getTextColor();
            return '#FFFFFF';
          },
          font: { weight: '800', size: 11, family: 'Inter' },
          backgroundColor: (context) => {
            if (context.dataset.type === 'line') return 'transparent';
            return 'rgba(0,0,0,0.3)';
          },
          padding: { top: 4, bottom: 4, left: 6, right: 6 },
          borderRadius: 6,
          anchor: (context) => {
            if (context.dataset.type === 'bar' && context.chart.config._config.indexAxis === 'y') {
              return 'center';
            }
            return 'end';
          },
          align: (context) => {
            if (context.dataset.type === 'bar' && context.chart.config._config.indexAxis === 'y') {
              return 'center';
            }
            return 'end';
          },
          offset: 0,
          clamp: true,
          formatter: (value, context) => {
            if (value === null || value === undefined) return '';
            if (context.dataset.type === 'line' && context.dataset.label?.includes('%')) {
              return Number(value).toFixed(1) + '%';
            }
            return Number(value).toLocaleString('pt-BR');
          }
        },
        tooltip: {
          backgroundColor: '#1F2937',
          titleColor: '#F3F4F6',
          bodyColor: '#E5E7EB',
          borderColor: '#EB0A1E',
          borderWidth: 2,
          padding: 10,
          titleFont: { size: 12, weight: 'bold' },
          bodyFont: { size: 11 }
        }
      }
    },

    createParetoChart: (ctx, stats, onClickCallback) => {
      const labels = Object.keys(stats.defectTypes);
      const dataVals = Object.values(stats.defectTypes);

      const combined = labels.map((l, i) => ({ l, v: dataVals[i] }))
        .sort((a, b) => b.v - a.v)
        .slice(0, 8);

      if (State.charts.pareto) State.charts.pareto.destroy();

      return new Chart(ctx, {
        type: 'bar',
        data: {
          labels: combined.map(x => x.l.length > 15 ? x.l.substring(0, 12) + '...' : x.l),
          datasets: [{
            label: 'Saldo Defeito',
            data: combined.map(x => x.v),
            backgroundColor: (context) => {
              const colors = ['#EB0A1E','#F43646','#F85E6B','#FC8791','#FFAFB6','#FFC9CE','#FFE3E6','#FFF0F1'];
              return colors[context.dataIndex] || '#EB0A1E';
            },
            borderRadius: 8,
            borderSkipped: false,
            barPercentage: 0.7,
            categoryPercentage: 0.8
          }]
        },
        options: {
          ...Charts.baseConfig,
          indexAxis: 'y',
          plugins: {
            ...Charts.baseConfig.plugins,
            legend: { display: false },
            datalabels: {
              ...Charts.baseConfig.plugins.datalabels,
              anchor: 'center',
              align: 'center',
              offset: 0,
              backgroundColor: 'rgba(0,0,0,0.5)',
              color: '#FFFFFF',
              font: { weight: '800', size: 11 },
              formatter: (value) => Number(value).toLocaleString('pt-BR'),
              display: (context) => {
                const value = context.dataset.data[context.dataIndex];
                return value > 0;
              }
            }
          },
          scales: {
            x: {
              beginAtZero: true,
              grid: { color: Charts.getGridColor(), drawBorder: false },
              ticks: { color: Charts.getTextColor(), font: { size: 10 } }
            },
            y: {
              grid: { display: false },
              ticks: { color: Charts.getTextColor(), font: { size: 10, weight: '600' } }
            }
          },
          onClick: (event, elements) => {
            if (elements && elements.length > 0) {
              const index = elements[0].index;
              const defectLabel = combined[index].l;
              if (onClickCallback) {
                onClickCallback(defectLabel);
              }
            }
          }
        }
      });
    },

    createStatusChart: (ctx, stats) => {
      if (State.charts.status) State.charts.status.destroy();

      const maxValue = Math.max(stats.pendingSaldo, stats.pendingSaldoDef);

      return new Chart(ctx, {
        type: 'bar',
        data: {
          labels: ['Saldo p/ Checar', 'Saldo Defeito'],
          datasets: [{
            label: 'Quantidade',
            data: [stats.pendingSaldo, stats.pendingSaldoDef],
            backgroundColor: (context) => {
              const cctx = context.chart.ctx;
              const gradient = cctx.createLinearGradient(0, 0, 0, 300);
              if (context.dataIndex === 0) {
                gradient.addColorStop(0, '#FFB800');
                gradient.addColorStop(1, '#E5A600');
              } else {
                gradient.addColorStop(0, '#EB0A1E');
                gradient.addColorStop(1, '#C4081A');
              }
              return gradient;
            },
            borderRadius: 12,
            borderSkipped: false,
            barPercentage: 0.55,
            categoryPercentage: 0.8
          }]
        },
        options: {
          ...Charts.baseConfig,
          layout: {
            padding: {
              top: 30,
              bottom: 10,
              left: 10,
              right: 20
            }
          },
          plugins: {
            ...Charts.baseConfig.plugins,
            legend: { display: false },
            datalabels: {
              ...Charts.baseConfig.plugins.datalabels,
              anchor: 'end',
              align: 'end',
              offset: 5,
              backgroundColor: 'transparent',
              color: () => Charts.getTextColor(),
              font: { weight: '900', size: 12 },
              formatter: (value) => Number(value).toLocaleString('pt-BR'),
              display: (context) => {
                const value = context.dataset.data[context.dataIndex];
                return value > 0;
              }
            }
          },
          scales: {
            x: { 
              grid: { display: false }, 
              ticks: { color: Charts.getTextColor(), font: { size: 12, weight: '700' } } 
            },
            y: {
              beginAtZero: true,
              max: maxValue * 1.2,
              grid: { color: Charts.getGridColor(), drawBorder: false },
              ticks: { color: Charts.getTextColor(), font: { size: 11 } }
            }
          }
        }
      });
    },

    createDefectByPNChart: (ctx, defect, data) => {
      const { labels, values, cumPct } = data;
      const idx80 = cumPct.findIndex(p => p >= 80);
      const maxValue = Math.max(...values);

      if (State.charts.defectByPN) State.charts.defectByPN.destroy();

      return new Chart(ctx, {
        data: {
          labels: labels.map(l => l.length > 12 ? l.substring(0, 10) + '...' : l),
          datasets: [
            {
              type: 'bar',
              label: 'Saldo Defeito',
              data: values,
              backgroundColor: (context) => (context.dataIndex === idx80 ? '#FFB800' : '#EB0A1E'),
              borderRadius: 8,
              barPercentage: 0.6,
              categoryPercentage: 0.7,
              order: 2
            },
            {
              type: 'line',
              label: '% Acumulado',
              data: cumPct,
              borderColor: '#2D2D2D',
              backgroundColor: 'transparent',
              borderWidth: 3,
              borderDash: [5, 3],
              tension: 0.3,
              yAxisID: 'y1',
              order: 1,
              pointBackgroundColor: (context) => (context.dataIndex === idx80 ? '#FFB800' : '#EB0A1E'),
              pointBorderColor: '#FFFFFF',
              pointBorderWidth: 2,
              pointRadius: (context) => context.dataIndex === idx80 ? 8 : 5,
              fill: false
            }
          ]
        },
        options: {
          ...Charts.baseConfig,
          layout: {
            padding: {
              top: 30,
              bottom: 20,
              left: 10,
              right: 40
            }
          },
          plugins: {
            ...Charts.baseConfig.plugins,
            legend: { position: 'bottom' },
            datalabels: {
              display: true,
              color: (context) => context.dataset.type === 'line' ? Charts.getTextColor() : '#FFFFFF',
              backgroundColor: (context) => context.dataset.type === 'line' ? 'transparent' : 'rgba(0,0,0,0.35)',
              font: { weight: '800', size: 10 },
              anchor: (context) => context.dataset.type === 'line' ? 'end' : 'end',
              align: (context) => context.dataset.type === 'line' ? 'top' : 'end',
              offset: 4,
              formatter: (value, context) => context.dataset.type === 'line'
                ? Number(value).toFixed(1) + '%'
                : Number(value).toLocaleString('pt-BR'),
              display: (context) => {
                if (context.dataset.type === 'line') return true;
                const value = context.dataset.data[context.dataIndex];
                return value > 0;
              }
            }
          },
          scales: {
            x: { 
              grid: { display: false }, 
              ticks: { color: Charts.getTextColor(), font: { size: 10 }, maxRotation: 45, minRotation: 30 } 
            },
            y: {
              beginAtZero: true,
              max: maxValue * 1.15,
              grid: { color: Charts.getGridColor() },
              ticks: { color: Charts.getTextColor(), font: { size: 10 } }
            },
            y1: {
              beginAtZero: true,
              max: 100,
              position: 'right',
              grid: { display: false },
              ticks: { color: Charts.getTextColor(), font: { size: 10 }, callback: (v) => v + '%' }
            }
          }
        }
      });
    },

    createMissingCheckChart: (ctx, data) => {
      const { labels, values, items } = data;
      const maxValue = Math.max(...values);

      if (State.charts.missingCheck) State.charts.missingCheck.destroy();

      return new Chart(ctx, {
        type: 'bar',
        data: {
          labels: labels.map(l => l.length > 15 ? l.substring(0, 12) + '...' : l),
          datasets: [{
            label: 'Saldo (checagem)',
            data: values,
            backgroundColor: (context) => {
              const cctx = context.chart.ctx;
              const gradient = cctx.createLinearGradient(0, 0, 0, 320);
              gradient.addColorStop(0, '#EB0A1E');
              gradient.addColorStop(1, '#C4081A');
              return gradient;
            },
            borderRadius: 8,
            barPercentage: 0.6,
            categoryPercentage: 0.7,
            borderSkipped: false
          }]
        },
        options: {
          ...Charts.baseConfig,
          layout: {
            padding: {
              top: 30,
              bottom: 20,
              left: 10,
              right: 20
            }
          },
          plugins: {
            ...Charts.baseConfig.plugins,
            legend: { display: false },
            datalabels: {
              ...Charts.baseConfig.plugins.datalabels,
              anchor: 'end',
              align: 'end',
              offset: 5,
              backgroundColor: 'rgba(0,0,0,0.25)',
              color: '#FFFFFF',
              font: { weight: '900', size: 11 },
              formatter: (value) => Number(value).toLocaleString('pt-BR'),
              display: (context) => {
                const value = context.dataset.data[context.dataIndex];
                return value > 0;
              }
            },
            tooltip: {
              ...Charts.baseConfig.plugins.tooltip,
              callbacks: {
                label: (context) => {
                  const item = items[context.dataIndex];
                  if (!item || item.pn === 'OUTROS') {
                    return `Saldo: ${context.parsed.y.toLocaleString('pt-BR')}`;
                  }
                  return [
                    `Saldo: ${context.parsed.y.toLocaleString('pt-BR')}`,
                    `Período: ${Utils.formatDateFromTs(item.minTs)} - ${Utils.formatDateFromTs(item.maxTs)}`
                  ];
                }
              }
            }
          },
          scales: {
            x: { 
              grid: { display: false }, 
              ticks: { color: Charts.getTextColor(), font: { size: 10, weight: '600' } } 
            },
            y: {
              beginAtZero: true,
              max: maxValue * 1.2,
              grid: { color: Charts.getGridColor(), drawBorder: false },
              ticks: { color: Charts.getTextColor(), font: { size: 10 } }
            }
          }
        }
      });
    },

    // Criar gráfico da área do reparo - REDUZIDO
    createAreaChart: (ctx, areaData) => {
      if (State.charts.areaChart) State.charts.areaChart.destroy();

      const topItems = areaData.items.slice(0, 6); // Reduzido de 8 para 6 itens
      const labels = topItems.map(item => item.pn.length > 10 ? item.pn.substring(0, 8) + '...' : item.pn);
      const values = topItems.map(item => item.areaParcial);
      const total = areaData.total;
      const porcentagem = (total / CONFIG.AREA_LIMIT) * 100;

      let corBarra = '#3B82F6'; // Azul padrão
      if (porcentagem >= 70 && porcentagem < 100) corBarra = '#EAB308'; // Amarelo
      if (porcentagem >= 100) corBarra = '#EF4444'; // Vermelho

      return new Chart(ctx, {
        type: 'bar',
        data: {
          labels: labels,
          datasets: [{
            label: 'Área Ocupada (m²)',
            data: values,
            backgroundColor: corBarra,
            borderRadius: 8,
            barPercentage: 0.6,
            categoryPercentage: 0.7,
            maxBarThickness: 40 // Limitado
          }]
        },
        options: {
          ...Charts.baseConfig,
          plugins: {
            ...Charts.baseConfig.plugins,
            legend: { display: false },
            title: {
              display: true,
              text: `Área: ${total.toFixed(1)} m² (${porcentagem.toFixed(1)}%)`,
              color: Charts.getTextColor(),
              font: { size: 11, weight: 'bold' }
            },
            datalabels: {
              ...Charts.baseConfig.plugins.datalabels,
              anchor: 'end',
              align: 'end',
              offset: 4,
              backgroundColor: 'transparent',
              color: () => Charts.getTextColor(),
              font: { weight: 'bold', size: 9 },
              formatter: (value) => value.toFixed(1) + ' m²',
              display: (context) => {
                const value = context.dataset.data[context.dataIndex];
                return value > 0;
              }
            }
          },
          scales: {
            x: { 
              grid: { display: false },
              ticks: { color: Charts.getTextColor(), font: { size: 9 } }
            },
            y: {
              beginAtZero: true,
              grid: { color: Charts.getGridColor() },
              ticks: { color: Charts.getTextColor(), font: { size: 9 } }
            }
          }
        }
      });
    },

    // Criar gráfico comparativo (Saldo Defeito vs Scrap) - CORRIGIDO
    createComparativeChart: (ctx, data) => {
      if (State.charts.comparativeChart) State.charts.comparativeChart.destroy();

      const isMonthly = State.comparativeChart.view === 'monthly';
      const currentYear = State.comparativeChart.year;
      
      let labels = [];
      let saldoDefData = [];
      let scrapData = [];

      if (isMonthly) {
        // Dados mensais do ano selecionado
        labels = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
        
        // Inicializar arrays com zeros
        saldoDefData = new Array(12).fill(0);
        scrapData = new Array(12).fill(0);
        
        // Preencher com dados do ano selecionado
        data.forEach(row => {
          const date = Utils.parseDateBR(row[COL.data]);
          if (!date || date.getFullYear() !== currentYear) return;
          
          const month = date.getMonth(); // 0-11
          const saldoDef = Utils.int(row[COL.saldoDef]);
          const scrap = Utils.int(row[COL.scrapTotal]) || 
                       (Utils.int(row[COL.scr1]) + Utils.int(row[COL.scr2]) + Utils.int(row[COL.scr3]));
          
          saldoDefData[month] += saldoDef;
          scrapData[month] += scrap;
        });
      } else {
        // Dados anuais (apenas anos que existem nos dados)
        const years = new Set();
        data.forEach(row => {
          const date = Utils.parseDateBR(row[COL.data]);
          if (date) {
            const year = date.getFullYear();
            // Filtrar anos válidos (entre 2000 e 2100)
            if (year >= 2000 && year <= 2100) {
              years.add(year);
            }
          }
        });
        
        const sortedYears = Array.from(years).sort((a, b) => a - b); // Ordem crescente
        
        // Se não houver anos válidos, mostrar mensagem
        if (sortedYears.length === 0) {
          labels = ['Sem dados'];
          saldoDefData = [0];
          scrapData = [0];
        } else {
          labels = sortedYears.map(y => y.toString());
          saldoDefData = new Array(sortedYears.length).fill(0);
          scrapData = new Array(sortedYears.length).fill(0);
          
          data.forEach(row => {
            const date = Utils.parseDateBR(row[COL.data]);
            if (!date) return;
            
            const year = date.getFullYear();
            // Filtrar anos válidos
            if (year < 2000 || year > 2100) return;
            
            const yearIndex = sortedYears.indexOf(year);
            if (yearIndex === -1) return;
            
            const saldoDef = Utils.int(row[COL.saldoDef]);
            const scrap = Utils.int(row[COL.scrapTotal]) || 
                         (Utils.int(row[COL.scr1]) + Utils.int(row[COL.scr2]) + Utils.int(row[COL.scr3]));
            
            saldoDefData[yearIndex] += saldoDef;
            scrapData[yearIndex] += scrap;
          });
        }
      }

      const maxValue = Math.max(...saldoDefData, ...scrapData, 1); // Garantir que não seja zero

      return new Chart(ctx, {
        type: 'bar',
        data: {
          labels: labels,
          datasets: [
            {
              label: 'Saldo Defeito',
              data: saldoDefData,
              backgroundColor: '#EB0A1E',
              borderRadius: 8,
              barPercentage: 0.35,
              categoryPercentage: 0.9,
              maxBarThickness: 50
            },
            {
              label: 'Scrap',
              data: scrapData,
              backgroundColor: '#1E293B',
              borderRadius: 8,
              barPercentage: 0.35,
              categoryPercentage: 0.9,
              maxBarThickness: 50
            }
          ]
        },
        options: {
          ...Charts.baseConfig,
          layout: {
            padding: {
              top: 50,
              bottom: 30,
              left: 15,
              right: 50
            }
          },
          plugins: {
            ...Charts.baseConfig.plugins,
            title: {
              display: true,
              text: isMonthly ? `Comparativo Mensal - ${currentYear}` : 'Comparativo Anual',
              color: Charts.getTextColor(),
              font: { size: 13, weight: 'bold' },
              padding: { bottom: 25 }
            },
            legend: {
              ...Charts.baseConfig.plugins.legend,
              position: 'top',
              align: 'center',
              labels: {
                ...Charts.baseConfig.plugins.legend.labels,
                padding: 20,
                usePointStyle: true,
                pointStyle: 'rectRounded',
                font: { size: 11 }
              }
            },
            datalabels: {
              ...Charts.baseConfig.plugins.datalabels,
              anchor: 'end',
              align: 'end',
              offset: 10,
              backgroundColor: 'transparent',
              color: () => Charts.getTextColor(),
              font: { weight: 'bold', size: 10 },
              formatter: (value) => value > 0 ? value.toLocaleString('pt-BR') : '',
              display: (context) => {
                const value = context.dataset.data[context.dataIndex];
                return value > 0;
              }
            }
          },
          scales: {
            x: { 
              grid: { display: false },
              ticks: { 
                color: Charts.getTextColor(), 
                font: { size: 11, weight: '600' },
                maxRotation: 45,
                minRotation: 30
              }
            },
            y: {
              beginAtZero: true,
              max: maxValue * 1.25,
              grid: { color: Charts.getGridColor(), drawBorder: false },
              ticks: { 
                color: Charts.getTextColor(), 
                font: { size: 10 },
                stepSize: Math.ceil(maxValue / 6) || 1
              },
              title: {
                display: true,
                text: 'Quantidade',
                color: Charts.getTextColor(),
                font: { size: 11, weight: 'bold' },
                padding: { bottom: 15 }
              }
            }
          }
        }
      });
    }
  };

  // ==================== GERENCIAMENTO DE DADOS ====================
  const DataManager = {
    fetchData: async (isManual = false) => {
      if (State.isFetching) return;
      State.isFetching = true;

      const cacheKey = `toyota_data_${CONFIG.SHEET_ID}`;
      const cached = localStorage.getItem(cacheKey);
      const cacheTime = localStorage.getItem(`${cacheKey}_time`);

      if (!isManual && cached && cacheTime && (Date.now() - cacheTime < CONFIG.CACHE_TIME)) {
        try {
          State.data = JSON.parse(cached);
          DataManager.processData();
          State.isFetching = false;
          State.connectionStatus = 'cache';
          UI.updateConnectionStatus();
          UI.hideConnBanner();
          Utils.showToast('Dados carregados do cache', 'info');
          return;
        } catch (e) {
          console.warn('Erro ao ler cache:', e);
        }
      }

      Utils.showSkeleton('table-body', 5, 24);
      UI.updateLastUpdate('Sincronizando...');

      const url = `https://docs.google.com/spreadsheets/d/${CONFIG.SHEET_ID}/export?format=csv&gid=${CONFIG.GID}&t=${Date.now()}`;

      try {
        const response = await Utils.fetchWithRetry(url);
        let csvText = await response.text();
        
        // Remove BOM if present
        csvText = csvText.replace(/^\uFEFF/, '');

        const parsed = Papa.parse(csvText, {
          header: true,
          skipEmptyLines: true,
          transform: (value) => value?.trim() || ''
        });

        if (parsed.errors && parsed.errors.length) throw new Error(parsed.errors[0]?.message || 'Erro ao parsear CSV');

        if (State.data.length > 0) {
          State.previousStats = DataManager.computeStats(State.data);
        }

        State.data = Array.isArray(parsed.data) ? parsed.data : [];

        try {
          localStorage.setItem(cacheKey, JSON.stringify(State.data));
          localStorage.setItem(`${cacheKey}_time`, Date.now());
        } catch (e) {
          console.warn('Erro ao salvar cache:', e);
        }

        State.connectionStatus = 'online';
        DataManager.processData();
        UI.hideConnBanner();
        Utils.showToast('Dados atualizados com sucesso!', 'success');
      } catch (err) {
        console.error('Erro ao buscar dados:', err);
        State.connectionStatus = 'offline';

        if (cached) {
          try {
            State.data = JSON.parse(cached);
            DataManager.processData();
            UI.showConnBanner('Usando dados em cache', 'Conexão instável - dados podem estar desatualizados', err.message);
            Utils.showToast('Usando dados em cache', 'warning');
          } catch (e) {
            UI.showConnBanner('Erro de conexão', 'Não foi possível carregar os dados', err.message);
          }
        } else {
          UI.showConnBanner('Erro de conexão', 'Não foi possível carregar os dados', err.message);
        }
      } finally {
        State.isFetching = false;
        UI.updateLastUpdate();
        UI.updateConnectionStatus();
      }
    },

    processData: () => {
      UI.buildCheckedFilterOptions();
      UI.renderMenuSummary();
      UI.updateScreen();
      UI.checkAlerts();
      
      // Calcular área do reparo para o gráfico da página inicial
      const areaResult = DataManager.computeRepairArea(State.data);
      State.areaDetails = {
        ...areaResult,
        lastUpdate: new Date()
      };
    },

    matchesFamily: (rowPN, familyList) => {
      const pn = Utils.normalizePN(rowPN);
      if (!pn) return false;
      return familyList.some(sfx => {
        const suf = Utils.normalizePN(sfx);
        return suf && (pn === suf || pn.endsWith(suf));
      });
    },

    applyQuickFilters: (rows) => {
      const { search, saldo, saldoDef, scrap, sort } = State.quickFilters;
      
      let filtered = [...rows];
      
      if (search && search.trim() !== '') {
        const searchLower = search.toLowerCase().trim();
        filtered = filtered.filter(row => {
          return (
            Utils.txt(row[COL.part]).toLowerCase().includes(searchLower) ||
            Utils.txt(row[COL.die]).toLowerCase().includes(searchLower) ||
            Utils.txt(row[COL.tipoDef]).toLowerCase().includes(searchLower) ||
            Utils.txt(row[COL.who1]).toLowerCase().includes(searchLower) ||
            Utils.txt(row[COL.who2]).toLowerCase().includes(searchLower) ||
            Utils.txt(row[COL.who3]).toLowerCase().includes(searchLower)
          );
        });
      }
      
      if (saldo) {
        filtered = filtered.filter(row => Utils.int(row[COL.saldo]) > 0);
      }
      
      if (saldoDef) {
        filtered = filtered.filter(row => Utils.int(row[COL.saldoDef]) > 0);
      }
      
      if (scrap) {
        filtered = filtered.filter(row => {
          const scr1 = Utils.int(row[COL.scr1]);
          const scr2 = Utils.int(row[COL.scr2]);
          const scr3 = Utils.int(row[COL.scr3]);
          return (scr1 + scr2 + scr3) > 0;
        });
      }
      
      if (sort) {
        filtered.sort((a, b) => {
          switch(sort) {
            case 'saldodef_desc':
              return Utils.int(b[COL.saldoDef]) - Utils.int(a[COL.saldoDef]);
            case 'date_desc': {
              const da = Utils.parseDateBR(a[COL.data]);
              const db = Utils.parseDateBR(b[COL.data]);
              if (!da && !db) return 0;
              if (!da) return 1;
              if (!db) return -1;
              return db.getTime() - da.getTime();
            }
            case 'date_asc': {
              const da = Utils.parseDateBR(a[COL.data]);
              const db = Utils.parseDateBR(b[COL.data]);
              if (!da && !db) return 0;
              if (!da) return 1;
              if (!db) return -1;
              return da.getTime() - db.getTime();
            }
            default:
              return 0;
          }
        });
      }
      
      return filtered;
    },

    applyDateFilter: (rows) => {
      const { day, month, year } = State.checkedFilter;
      if (!day && !month && !year) return rows;

      return rows.filter(row => {
        const d = Utils.parseDateBR(row[COL.data]);
        if (!d) return false;

        const yy = String(d.getFullYear());
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');

        if (year && yy !== year) return false;
        if (month && mm !== month) return false;
        if (day && dd !== day) return false;

        return true;
      });
    },

    computeStats: (data) => {
      const stats = {
        checked: 0,
        saldoDef: 0,
        repairs: 0,
        scrap: 0,
        pendingSaldo: 0,
        pendingSaldoDef: 0,
        defectTypes: {},
        totalChecked: 0,
        totalRepairs: 0,
        totalScrap: 0
      };

      for (const row of data) {
        const tipoDefKey = Utils.normalizeDefect(Utils.txt(row[COL.tipoDef]));

        const chec1 = Utils.int(row[COL.chec1]);
        const chec2 = Utils.int(row[COL.chec2]);
        const chec3 = Utils.int(row[COL.chec3]);

        const rep1 = Utils.int(row[COL.rep1]);
        const rep2 = Utils.int(row[COL.rep2]);
        const rep3 = Utils.int(row[COL.rep3]);

        const scr1 = Utils.int(row[COL.scr1]);
        const scr2 = Utils.int(row[COL.scr2]);
        const scr3 = Utils.int(row[COL.scr3]);

        const scrapTotal = Utils.int(row[COL.scrapTotal]) || (scr1 + scr2 + scr3);
        const saldo = Utils.int(row[COL.saldo]);
        const saldoDef = Utils.int(row[COL.saldoDef]);

        stats.checked += (chec1 + chec2 + chec3);
        stats.repairs += (rep1 + rep2 + rep3);
        stats.scrap += scrapTotal;
        stats.saldoDef += saldoDef;

        stats.totalChecked += (chec1 + chec2 + chec3);
        stats.totalRepairs += (rep1 + rep2 + rep3);
        stats.totalScrap += scrapTotal;

        if (saldo > 0) stats.pendingSaldo += saldo;
        if (saldoDef > 0) stats.pendingSaldoDef += saldoDef;

        if (saldoDef > 0 && tipoDefKey !== '-') {
          stats.defectTypes[tipoDefKey] = (stats.defectTypes[tipoDefKey] || 0) + saldoDef;
        }
      }
      
      stats.reworkPct = stats.totalChecked > 0 
        ? Utils.calculatePercentage(stats.totalRepairs, stats.totalChecked)
        : 0;
      stats.scrapPct = stats.totalChecked > 0
        ? Utils.calculatePercentage(stats.totalScrap, stats.totalChecked)
        : 0;

      return stats;
    },
    
    getTopDefect: (stats) => {
      const defects = Object.entries(stats.defectTypes)
        .map(([name, qty]) => ({ name, qty }))
        .sort((a, b) => b.qty - a.qty);
      
      return defects[0] || null;
    },
    
    getTopPNs: (data) => {
      const pnMap = {};
      
      for (const row of data) {
        const pn = Utils.txt(row[COL.part]);
        if (!pn || pn === '-') continue;
        
        // SOMA DOS REPARADOS (3 turnos) - isso que define criticidade
        const rep1 = Utils.int(row[COL.rep1]);
        const rep2 = Utils.int(row[COL.rep2]);
        const rep3 = Utils.int(row[COL.rep3]);
        const totalReparos = rep1 + rep2 + rep3;
        
        // Só considera se teve reparo
        if (totalReparos <= 0) continue;
        
        pnMap[pn] = (pnMap[pn] || 0) + totalReparos;
      }
      
      return Object.entries(pnMap)
        .map(([pn, qty]) => ({ pn, qty }))
        .sort((a, b) => b.qty - a.qty)
        .slice(0, 3);
    },
    
    // Função para calcular área do reparo e salvar detalhes
    computeRepairArea: (data) => {
      let totalArea = 0;
      let linhasProcessadas = 0;
      let items = [];

      for (const row of data) {
        // Considerar APENAS saldo (checagem)
        const saldo = Utils.int(row[COL.saldo]);

        // Só entra no cálculo quem tiver saldo > 0
        if (saldo <= 0) continue;

        const pn = Utils.txt(row[COL.part]);
        const saldoDef = Utils.int(row[COL.saldoDef]);

        // Converte os valores
        let areaPallet = Utils.float(row[COL.areaPallet]);
        let empilha = Utils.int(row[COL.empilhaMax]);
        let pecasPorPallet = Utils.int(row[COL.pecasPorPallet]);

        // Se não encontrar, usa valores padrão
        if (!empilha || empilha <= 0) empilha = 1;
        if (!pecasPorPallet || pecasPorPallet <= 0) pecasPorPallet = 1;

        // Valida se tem área do pallet
        if (!areaPallet || areaPallet <= 0) continue;

        // pendente = saldo (somente)
        const pendente = saldo;

        // Pallets necessários
        const palletsNecessarios = Math.ceil(pendente / pecasPorPallet);

        // Posições no chão
        const posicoesChao = Math.ceil(palletsNecessarios / empilha);

        // Área parcial
        const areaParcial = posicoesChao * areaPallet;

        // Salva detalhes para o modal
        items.push({
          pn,
          saldo,
          saldoDef,
          pendente,
          areaPallet,
          empilha,
          pecasPorPallet,
          palletsNecessarios,
          posicoesChao,
          areaParcial
        });

        totalArea += areaParcial;
        linhasProcessadas++;
      }

      // Ordena por maior área
      items.sort((a, b) => b.areaParcial - a.areaParcial);

      return {
        total: totalArea,
        items: items,
        count: linhasProcessadas
      };
    },
    
    // ✅ CORRIGIDO: Obter anos disponíveis para o gráfico comparativo
    getAvailableYears: () => {
      const years = new Set();
      
      State.data.forEach(row => {
        const date = Utils.parseDateBR(row[COL.data]);
        if (date) {
          const year = date.getFullYear();
          // Filtrar anos válidos (entre 2000 e 2100)
          if (year >= 2000 && year <= 2100) {
            years.add(year);
          }
        }
      });
      
      return Array.from(years).sort((a, b) => b - a); // Ordem decrescente
    },
    
    // ========== FUNÇÕES DE BACKUP ==========
    
    // Criar backup dos dados
    createBackup: (saveToCache = true) => {
      if (!State.data || State.data.length === 0) {
        Utils.showToast('Não há dados para fazer backup', 'warning');
        return;
      }
      
      try {
        // Estimar tamanho dos dados
        const jsonString = JSON.stringify(State.data);
        const dataSize = new Blob([jsonString]).size;
        
        const backupData = {
          version: CONFIG.VERSION,
          timestamp: Date.now(),
          date: new Date().toISOString(),
          data: State.data,
          stats: DataManager.computeStats(State.data),
          metadata: {
            rows: State.data.length,
            size: Utils.formatFileSize(dataSize),
            sheetId: CONFIG.SHEET_ID
          }
        };
        
        const jsonBackup = JSON.stringify(backupData, null, 2);
        const fileName = Utils.generateBackupFileName();
        
        // Download do arquivo
        Utils.downloadFile(jsonBackup, fileName);
        
        // Salvar referência do backup
        const backupRefs = JSON.parse(localStorage.getItem('toyota_backups') || '[]');
        
        // Verificar se já existe um backup com mesmo nome
        const existingIndex = backupRefs.findIndex(b => b.name === fileName);
        const backupInfo = {
          name: fileName,
          timestamp: Date.now(),
          rows: State.data.length,
          size: Utils.formatFileSize(dataSize),
          cached: false
        };
        
        if (existingIndex >= 0) {
          backupRefs[existingIndex] = backupInfo;
        } else {
          backupRefs.unshift(backupInfo);
        }
        
        // Opcional: salvar no cache para download posterior (apenas os mais recentes)
        if (saveToCache) {
          try {
            // Limitar número de backups em cache
            const cachedBackups = backupRefs.filter(b => b.cached).length;
            
            if (cachedBackups < CONFIG.MAX_CACHED_BACKUPS) {
              localStorage.setItem(`toyota_backup_content_${fileName}`, jsonBackup);
              backupInfo.cached = true;
              Utils.showToast(`Backup criado e armazenado em cache (poderá baixar novamente)`, 'success', 4000);
            } else {
              // Remover o cache mais antigo
              const oldestCached = backupRefs.filter(b => b.cached).sort((a, b) => a.timestamp - b.timestamp)[0];
              if (oldestCached) {
                localStorage.removeItem(`toyota_backup_content_${oldestCached.name}`);
                oldestCached.cached = false;
              }
              localStorage.setItem(`toyota_backup_content_${fileName}`, jsonBackup);
              backupInfo.cached = true;
              Utils.showToast(`Backup criado (cache atualizado - backup mais antigo removido do cache)`, 'success', 4000);
            }
          } catch (e) {
            console.warn('Cache muito grande, não foi possível armazenar conteúdo completo');
            Utils.showToast('Backup criado (não armazenado em cache devido ao tamanho)', 'warning', 4000);
          }
        }
        
        // Manter apenas os últimos MAX_BACKUPS na lista
        if (backupRefs.length > CONFIG.MAX_BACKUPS) {
          const removed = backupRefs.pop();
          // Limpar cache do removido se existir
          if (removed && removed.cached) {
            localStorage.removeItem(`toyota_backup_content_${removed.name}`);
          }
        }
        
        localStorage.setItem('toyota_backups', JSON.stringify(backupRefs));
        State.backups.list = backupRefs;
        
        // Atualizar lista se o modal estiver aberto
        if (document.getElementById('backup-modal')?.classList.contains('flex')) {
          UI.updateBackupList();
        }
        
      } catch (err) {
        console.error('Erro ao criar backup:', err);
        Utils.showToast('Erro ao criar backup: ' + err.message, 'error', 5000);
      }
    },
    
    // Restaurar dados de backup
    restoreBackup: (jsonContent, fileName) => {
      if (State.backups.isRestoring) return;
      
      try {
        State.backups.isRestoring = true;
        
        const backupData = JSON.parse(jsonContent);
        
        // Validar estrutura do backup
        if (!backupData.data || !Array.isArray(backupData.data)) {
          throw new Error('Arquivo de backup inválido: estrutura de dados não encontrada');
        }
        
        if (backupData.version && backupData.version !== CONFIG.VERSION) {
          if (!confirm(`⚠️ ATENÇÃO: Este backup foi criado com a versão ${backupData.version}. A versão atual é ${CONFIG.VERSION}.\n\nDeseja restaurar mesmo assim?`)) {
            State.backups.isRestoring = false;
            return;
          }
        }
        
        // Confirmar restauração
        if (!confirm(`Deseja restaurar ${backupData.data.length} registros do arquivo "${fileName}"?\n\nOs dados atuais (${State.data.length} registros) serão substituídos.`)) {
          State.backups.isRestoring = false;
          return;
        }
        
        // Restaurar dados
        State.data = backupData.data;
        State.previousStats = null;
        
        // Atualizar cache
        const cacheKey = `toyota_data_${CONFIG.SHEET_ID}`;
        try {
          localStorage.setItem(cacheKey, JSON.stringify(State.data));
          localStorage.setItem(`${cacheKey}_time`, Date.now());
        } catch (e) {
          console.warn('Erro ao salvar cache após restauração:', e);
        }
        
        // Processar dados restaurados
        DataManager.processData();
        
        State.backups.isRestoring = false;
        
        Utils.showToast(`✅ Dados restaurados de "${fileName}"`, 'success', 5000);
        
        // Se estiver no menu, voltar para visão geral
        if (State.currentScreen === 'menu') {
          UI.selectPN('GERAL');
        } else {
          UI.updateScreen();
        }
        
        // Fechar modal de backup
        UI.closeBackupModal();
        
      } catch (err) {
        console.error('Erro ao restaurar backup:', err);
        Utils.showToast('❌ Erro ao restaurar backup: ' + err.message, 'error', 5000);
        State.backups.isRestoring = false;
      }
    },
    
    // Carregar arquivo de backup
    loadBackupFile: () => {
      Utils.loadFile((content, fileName) => {
        DataManager.restoreBackup(content, fileName);
      });
    },
    
    // Download de backup pelo nome
    downloadBackupByName: (fileName) => {
      // Primeiro, verifica se o arquivo ainda está no cache do localStorage
      const backupContent = localStorage.getItem(`toyota_backup_content_${fileName}`);
      
      if (backupContent) {
        // Se encontrou no cache, baixa novamente
        try {
          Utils.downloadFile(backupContent, fileName);
          
          // Atualizar timestamp do backup (opcional)
          const backupRefs = JSON.parse(localStorage.getItem('toyota_backups') || '[]');
          const backupIndex = backupRefs.findIndex(b => b.name === fileName);
          if (backupIndex >= 0) {
            backupRefs[backupIndex].lastDownloaded = Date.now();
            localStorage.setItem('toyota_backups', JSON.stringify(backupRefs));
            State.backups.list = backupRefs;
          }
          
          Utils.showToast(`📥 Backup "${fileName}" baixado do cache`, 'success', 3000);
        } catch (e) {
          Utils.showToast('Erro ao ler backup do cache', 'error');
        }
      } else {
        // Se não encontrou no cache, mostra instruções
        Utils.showToast(
          `📂 Arquivo não está mais no cache. Localize-o na pasta Downloads do seu computador.`, 
          'info', 
          5000
        );
      }
    },
    
    // Apagar backup da lista e do cache
    deleteBackup: (fileName) => {
      if (!confirm(`Tem certeza que deseja apagar o backup "${fileName}" da lista?\n\nIsso não apagará o arquivo do seu computador, apenas removerá da lista de backups recentes.`)) {
        return;
      }
      
      const backupRefs = JSON.parse(localStorage.getItem('toyota_backups') || '[]');
      const backupIndex = backupRefs.findIndex(b => b.name === fileName);
      
      if (backupIndex >= 0) {
        const backup = backupRefs[backupIndex];
        
        // Remover do cache se existir
        if (backup.cached) {
          localStorage.removeItem(`toyota_backup_content_${fileName}`);
        }
        
        // Remover da lista
        backupRefs.splice(backupIndex, 1);
        localStorage.setItem('toyota_backups', JSON.stringify(backupRefs));
        State.backups.list = backupRefs;
        
        // Atualizar lista se o modal estiver aberto
        if (document.getElementById('backup-modal')?.classList.contains('flex')) {
          UI.updateBackupList();
        }
        
        Utils.showToast(`🗑️ Backup "${fileName}" removido da lista`, 'success', 3000);
      }
    },
    
    // Apagar todos os backups
    deleteAllBackups: () => {
      if (!confirm(`⚠️ ATENÇÃO: Deseja apagar TODOS os backups da lista?\n\nIsso não apagará os arquivos do seu computador, apenas removerá todos da lista de backups recentes e limpará o cache.`)) {
        return;
      }
      
      const backupRefs = JSON.parse(localStorage.getItem('toyota_backups') || '[]');
      
      // Limpar cache de todos os backups
      backupRefs.forEach(backup => {
        if (backup.cached) {
          localStorage.removeItem(`toyota_backup_content_${backup.name}`);
        }
      });
      
      // Limpar lista
      localStorage.removeItem('toyota_backups');
      State.backups.list = [];
      
      // Atualizar lista se o modal estiver aberto
      if (document.getElementById('backup-modal')?.classList.contains('flex')) {
        UI.updateBackupList();
      }
      
      Utils.showToast('🗑️ Todos os backups foram removidos da lista', 'success', 3000);
    },
    
    // Listar backups recentes
    getBackupList: () => {
      return JSON.parse(localStorage.getItem('toyota_backups') || '[]');
    }
  };

  // ==================== INTERFACE DO USUÁRIO ====================
  const UI = {
    init: () => {
      Charts.register();

      UI.initTheme();
      UI.bindEvents();
      UI.initQuickFilters();
      
      // Carregar lista de backups
      State.backups.list = DataManager.getBackupList();
      
      // Inicializar ano do gráfico comparativo
      const availableYears = DataManager.getAvailableYears();
      if (availableYears.length > 0) {
        State.comparativeChart.year = availableYears[0];
      } else {
        State.comparativeChart.year = new Date().getFullYear();
      }
      
      Utils.checkScreenSize();
      window.addEventListener('resize', Utils.debounce(Utils.checkScreenSize, 150));

      document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 'r') { e.preventDefault(); UI.manualRefresh(); }
        if (e.key === 'Escape') { UI.closeLoginModal(); UI.closeManualModal(); UI.closeAreaModal(); UI.closeBackupModal(); }
        if (e.key === '?' || (e.ctrlKey && e.key === 'h')) { e.preventDefault(); UI.openManualModal(); }
        if (e.ctrlKey && e.key === 'l') { e.preventDefault(); UI.clearQuickFilters(); }
        if (e.ctrlKey && e.key === 'b') { e.preventDefault(); UI.openBackupModal(); }
      });

      window.addEventListener('online', () => { 
        Utils.showToast('Conexão restabelecida', 'success'); 
        DataManager.fetchData(true); 
      });
      
      window.addEventListener('offline', () => { 
        Utils.showToast('Modo offline - usando cache', 'warning');
        State.connectionStatus = 'offline';
        UI.updateConnectionStatus();
      });

      UI.startUpdateCycle();
      
      console.log(`🚀 Toyota Quality Control ${CONFIG.VERSION} iniciado`);
    },
    
    // Funções para controlar os cards da página inicial
    toggleAreaCard: () => {
      State.menuCards.areaExpanded = !State.menuCards.areaExpanded;
      UI.renderMenuCharts();
    },
    
    toggleComparativeCard: () => {
      State.menuCards.comparativeExpanded = !State.menuCards.comparativeExpanded;
      UI.renderMenuCharts();
    },
    
    // Criar botões de backup - AGORA SÓ CRIA QUANDO NECESSÁRIO
    createBackupButtons: () => {
      // Só criar botões se estiver na dashboard
      if (State.currentScreen !== 'dashboard') {
        console.log('Não está na dashboard, não criando botões');
        return;
      }
      
      // Verificar se já existe
      if (document.getElementById('btn-backup')) {
        return;
      }
      
      console.log('🔧 Criando botões de backup na dashboard...');
      
      // Procurar a div principal do header
      const headerDiv = document.querySelector('.flex.justify-between.items-center.h-16');
      
      if (!headerDiv) {
        console.error('❌ Não encontrou a div principal do header');
        return;
      }
      
      // Procurar o container do lado direito
      let rightContainer = headerDiv.querySelector('.flex.items-center.gap-3');
      
      if (!rightContainer) {
        rightContainer = document.createElement('div');
        rightContainer.className = 'flex items-center gap-3';
        headerDiv.appendChild(rightContainer);
      }
      
      // Botão de backup (salvar)
      const backupBtn = document.createElement('button');
      backupBtn.id = 'btn-backup';
      backupBtn.className = 'px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-bold transition flex items-center gap-2';
      backupBtn.innerHTML = `
        <i class="ph-bold ph-database"></i>
        <span>Backup</span>
      `;
      backupBtn.onclick = () => UI.openBackupModal();
      backupBtn.title = "Gerenciar backups (Ctrl+B)";
      
      // Botão de área
      const areaBtn = document.createElement('button');
      areaBtn.id = 'btn-area';
      areaBtn.className = 'px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-bold transition flex items-center gap-2';
      areaBtn.innerHTML = `
        <i class="ph-bold ph-map-trifold"></i>
        <span>Área</span>
      `;
      areaBtn.onclick = () => UI.openAreaModal();
      areaBtn.title = "Visualizar área do reparo";
      
      // Inserir no início do container
      rightContainer.insertBefore(backupBtn, rightContainer.firstChild);
      rightContainer.insertBefore(areaBtn, rightContainer.firstChild);
      
      console.log('✅ Botões de backup e área criados na dashboard');
    },
    
    // Remover botões de backup
    removeBackupButtons: () => {
      const backupBtn = document.getElementById('btn-backup');
      const areaBtn = document.getElementById('btn-area');
      
      if (backupBtn) {
        backupBtn.remove();
        console.log('Botão de backup removido');
      }
      
      if (areaBtn) {
        areaBtn.remove();
        console.log('Botão de área removido');
      }
    },
    
    // Criar modal de backup
    createBackupModal: () => {
      const modal = document.createElement('div');
      modal.id = 'backup-modal';
      modal.className = 'hidden absolute inset-0 bg-black/60 z-[999] items-center justify-center p-4';
      modal.innerHTML = `
        <div class="w-full max-w-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl shadow-xl p-5 max-h-[80vh] overflow-y-auto">
          <div class="flex items-center justify-between sticky top-0 bg-white dark:bg-gray-900 pb-3 border-b border-gray-200 dark:border-gray-800">
            <h3 class="text-lg font-extrabold text-gray-800 dark:text-gray-100 flex items-center gap-2">
              <i class="ph-bold ph-database text-green-600"></i>
              Gerenciamento de Backup
            </h3>
            <button onclick="ToyotaQC.UI.closeBackupModal()" class="text-gray-500 hover:text-red-600">
              <i class="ph-bold ph-x"></i>
            </button>
          </div>

          <div class="mt-4 space-y-4">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              <button id="backup-create-btn" class="p-4 bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-900 rounded-lg hover:bg-green-100 dark:hover:bg-green-950/40 transition flex items-center gap-3">
                <i class="ph-bold ph-download-simple text-2xl text-green-600"></i>
                <div class="text-left">
                  <p class="font-bold text-gray-800 dark:text-gray-200">Criar Backup</p>
                  <p class="text-xs text-gray-500">Salvar dados atuais</p>
                </div>
              </button>
              <button id="backup-restore-btn" class="p-4 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-950/40 transition flex items-center gap-3">
                <i class="ph-bold ph-upload-simple text-2xl text-blue-600"></i>
                <div class="text-left">
                  <p class="font-bold text-gray-800 dark:text-gray-200">Restaurar Backup</p>
                  <p class="text-xs text-gray-500">Carregar arquivo</p>
                </div>
              </button>
            </div>
            
            <div class="border-t border-gray-200 dark:border-gray-800 pt-4">
              <div class="flex items-center justify-between mb-3">
                <h4 class="font-bold text-gray-700 dark:text-gray-300 flex items-center gap-2">
                  <i class="ph-bold ph-clock-counter-clockwise"></i>
                  Backups Recentes
                </h4>
                <button id="backup-delete-all-btn" class="text-xs text-red-600 hover:text-red-800 flex items-center gap-1" title="Apagar todos da lista">
                  <i class="ph-bold ph-trash"></i>
                  Limpar lista
                </button>
              </div>
              <div id="backup-list" class="space-y-2 max-h-60 overflow-y-auto">
                <!-- Lista será preenchida dinamicamente -->
              </div>
            </div>
          </div>

          <div class="mt-6 pt-3 border-t border-gray-200 dark:border-gray-800 flex justify-end">
            <button onclick="ToyotaQC.UI.closeBackupModal()" class="px-4 py-2 bg-gray-200 dark:bg-gray-800 text-gray-800 dark:text-gray-200 rounded-lg text-sm font-bold hover:bg-gray-300 dark:hover:bg-gray-700 transition">
              Fechar
            </button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
      return modal;
    },
    
    // Abrir modal de backup
    openBackupModal: () => {
      let modal = document.getElementById('backup-modal');
      if (!modal) {
        modal = UI.createBackupModal();
      }
      
      UI.updateBackupList();
      
      // Bind dos botões do modal
      document.getElementById('backup-create-btn')?.addEventListener('click', () => {
        DataManager.createBackup(true); // true = salvar em cache
        UI.updateBackupList();
      });
      
      document.getElementById('backup-restore-btn')?.addEventListener('click', () => {
        UI.closeBackupModal();
        DataManager.loadBackupFile();
      });
      
      document.getElementById('backup-delete-all-btn')?.addEventListener('click', () => {
        DataManager.deleteAllBackups();
      });
      
      modal.classList.remove('hidden');
      modal.classList.add('flex');
    },
    
    // Fechar modal de backup
    closeBackupModal: () => {
      const modal = document.getElementById('backup-modal');
      if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
      }
    },
    
    // Atualizar lista de backups no modal
    updateBackupList: () => {
      const listEl = document.getElementById('backup-list');
      if (!listEl) return;
      
      const backups = DataManager.getBackupList();
      State.backups.list = backups;
      
      if (backups.length === 0) {
        listEl.innerHTML = '<p class="text-center text-gray-500 py-4">Nenhum backup recente encontrado</p>';
        return;
      }
      
      listEl.innerHTML = backups.map((backup) => {
        const date = new Date(backup.timestamp);
        const formattedDate = Utils.formatDateFull(date);
        const isCached = backup.cached || false;
        
        return `
          <div class="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg group hover:bg-gray-100 dark:hover:bg-gray-700 transition">
            <div class="flex items-center gap-3 flex-1 min-w-0">
              <i class="ph-bold ph-file-text ${isCached ? 'text-green-600' : 'text-gray-500'}"></i>
              <div class="min-w-0 flex-1">
                <p class="text-sm font-medium text-gray-700 dark:text-gray-300 truncate" title="${backup.name}">${backup.name}</p>
                <p class="text-xs text-gray-500">
                  ${formattedDate} • ${backup.rows} registros • ${backup.size || '--'}
                  ${isCached ? ' • 💾 Em cache' : ''}
                </p>
              </div>
            </div>
            <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
              <button onclick="ToyotaQC.UI.downloadBackup('${backup.name}')" 
                      class="p-2 text-blue-600 hover:text-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900/30 rounded-lg" 
                      title="${isCached ? 'Baixar do cache' : 'Baixar (não está em cache)'}">
                <i class="ph-bold ph-download"></i>
              </button>
              <button onclick="ToyotaQC.UI.deleteBackup('${backup.name}')" 
                      class="p-2 text-red-600 hover:text-red-800 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg" 
                      title="Remover da lista">
                <i class="ph-bold ph-trash"></i>
              </button>
            </div>
          </div>
        `;
      }).join('');
    },
    
    // Download de backup pelo nome
    downloadBackup: (fileName) => {
      DataManager.downloadBackupByName(fileName);
    },
    
    // Apagar backup
    deleteBackup: (fileName) => {
      DataManager.deleteBackup(fileName);
    },
    
    // Abrir modal da área
    openAreaModal: () => {
      console.log('📱 Abrindo modal da área');
      let modal = document.getElementById('area-modal');
      if (!modal) {
        modal = UI.createAreaModal();
      }
      
      UI.updateAreaModalContent();
      modal.classList.remove('hidden');
      modal.classList.add('flex');
    },
    
    // Fechar modal da área
    closeAreaModal: () => {
      const modal = document.getElementById('area-modal');
      if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
      }
    },
    
    // Criar modal da área
    createAreaModal: () => {
      const modal = document.createElement('div');
      modal.id = 'area-modal';
      modal.className = 'hidden absolute inset-0 bg-black/60 z-[999] items-center justify-center p-4';
      modal.innerHTML = `
        <div class="w-full max-w-4xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl shadow-xl p-5 max-h-[80vh] overflow-y-auto">
          <div class="flex items-center justify-between sticky top-0 bg-white dark:bg-gray-900 pb-3 border-b border-gray-200 dark:border-gray-800">
            <h3 class="text-lg font-extrabold text-gray-800 dark:text-gray-100 flex items-center gap-2">
              <i class="ph-bold ph-map-trifold text-blue-600"></i>
              Área do Reparo
            </h3>
            <button onclick="ToyotaQC.UI.closeAreaModal()" class="text-gray-500 hover:text-red-600">
              <i class="ph-bold ph-x"></i>
            </button>
          </div>

          <div id="area-modal-content" class="mt-4 space-y-4">
            <!-- Conteúdo será preenchido dinamicamente -->
            <div class="flex items-center justify-center py-8">
              <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
      return modal;
    },
    
    // Atualizar conteúdo do modal da área
    updateAreaModalContent: () => {
      const content = document.getElementById('area-modal-content');
      if (!content) return;
      
      const { total, items, count } = State.areaDetails;
      const porcentagem = (total / CONFIG.AREA_LIMIT) * 100;
      
      let corClasse = 'text-green-600';
      let bgClasse = 'bg-green-100 dark:bg-green-900/30';
      if (porcentagem >= 70 && porcentagem < 100) {
        corClasse = 'text-yellow-600 dark:text-yellow-500';
        bgClasse = 'bg-yellow-100 dark:bg-yellow-900/30';
      } else if (porcentagem >= 100) {
        corClasse = 'text-red-600 dark:text-red-500';
        bgClasse = 'bg-red-100 dark:bg-red-900/30';
      }
      
      let html = `
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div class="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 text-center">
            <p class="text-sm text-gray-500 dark:text-gray-400">Área Total</p>
            <p class="text-3xl font-black ${corClasse}">${total.toFixed(1)} m²</p>
          </div>
          <div class="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 text-center">
            <p class="text-sm text-gray-500 dark:text-gray-400">Limite</p>
            <p class="text-3xl font-black text-gray-700 dark:text-gray-300">${CONFIG.AREA_LIMIT} m²</p>
          </div>
          <div class="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 text-center">
            <p class="text-sm text-gray-500 dark:text-gray-400">Ocupação</p>
            <p class="text-3xl font-black ${corClasse}">${porcentagem.toFixed(1)}%</p>
          </div>
        </div>
        
        <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-4 mb-6">
          <div class="${bgClasse} h-4 rounded-full" style="width: ${Math.min(porcentagem, 100)}%"></div>
        </div>
      `;
      
      if (items.length > 0) {
        html += `
          <h4 class="font-bold text-gray-700 dark:text-gray-300 mb-3">Detalhamento por Produto (${count} itens)</h4>
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="bg-gray-100 dark:bg-gray-800">
                <tr>
                  <th class="px-3 py-2 text-left">PN</th>
                  <th class="px-3 py-2 text-right">Pendente</th>
                  <th class="px-3 py-2 text-right">Saldo</th>
                  <th class="px-3 py-2 text-right">Saldo Def</th>
                  <th class="px-3 py-2 text-right">Área/Pallet</th>
                  <th class="px-3 py-2 text-right">Empilha</th>
                  <th class="px-3 py-2 text-right">Peças/Pallet</th>
                  <th class="px-3 py-2 text-right">Pallets</th>
                  <th class="px-3 py-2 text-right">Posições</th>
                  <th class="px-3 py-2 text-right">Área (m²)</th>
                </tr>
              </thead>
              <tbody>
        `;

        items.forEach(item => {
          html += `
            <tr class="border-b border-gray-200 dark:border-gray-800">
              <td class="px-3 py-2 font-mono">${item.pn}</td>
              <td class="px-3 py-2 text-right font-bold">${(item.pendente || 0)}</td>
              <td class="px-3 py-2 text-right">${(item.saldo || 0)}</td>
              <td class="px-3 py-2 text-right">${(item.saldoDef || 0)}</td>
              <td class="px-3 py-2 text-right">${item.areaPallet.toFixed(2)}</td>
              <td class="px-3 py-2 text-right">${item.empilha}</td>
              <td class="px-3 py-2 text-right">${item.pecasPorPallet}</td>
              <td class="px-3 py-2 text-right">${item.palletsNecessarios}</td>
              <td class="px-3 py-2 text-right">${item.posicoesChao}</td>
              <td class="px-3 py-2 text-right font-bold ${item.areaParcial > 10 ? 'text-red-600' : ''}">${item.areaParcial.toFixed(2)}</td>
            </tr>
          `;
        });

        html += `
              </tbody>
            </table>
          </div>
        `;
      } else {
        html += '<p class="text-center text-gray-500 py-8">Nenhum produto com pendência</p>';
      }
      content.innerHTML = html;
    },
    
    initQuickFilters: () => {
      const searchInput = document.getElementById('quick-search');
      const saldoCheck = document.getElementById('filter-saldo');
      const saldoDefCheck = document.getElementById('filter-saldodef');
      const scrapCheck = document.getElementById('filter-scrap');
      const sortSelect = document.getElementById('quick-sort');
      const clearBtn = document.getElementById('clear-filters');
      
      if (searchInput) {
        searchInput.addEventListener('input', Utils.debounce((e) => {
          State.quickFilters.search = e.target.value;
          State.tablePager.page = 1;
          UI.updateActiveFiltersDisplay();
          UI.renderDashboard();
        }, 300));
      }
      
      if (saldoCheck) {
        saldoCheck.addEventListener('change', (e) => {
          State.quickFilters.saldo = e.target.checked;
          State.tablePager.page = 1;
          UI.updateActiveFiltersDisplay();
          UI.renderDashboard();
        });
      }
      
      if (saldoDefCheck) {
        saldoDefCheck.addEventListener('change', (e) => {
          State.quickFilters.saldoDef = e.target.checked;
          State.tablePager.page = 1;
          UI.updateActiveFiltersDisplay();
          UI.renderDashboard();
        });
      }
      
      if (scrapCheck) {
        scrapCheck.addEventListener('change', (e) => {
          State.quickFilters.scrap = e.target.checked;
          State.tablePager.page = 1;
          UI.updateActiveFiltersDisplay();
          UI.renderDashboard();
        });
      }
      
      if (sortSelect) {
        sortSelect.addEventListener('change', (e) => {
          State.quickFilters.sort = e.target.value;
          State.tablePager.page = 1;
          UI.updateActiveFiltersDisplay();
          UI.renderDashboard();
        });
      }
      
      if (clearBtn) {
        clearBtn.addEventListener('click', () => UI.clearQuickFilters());
      }
    },
    
    clearQuickFilters: () => {
      State.quickFilters = {
        search: '',
        saldo: false,
        saldoDef: false,
        scrap: false,
        sort: ''
      };
      
      const searchInput = document.getElementById('quick-search');
      const saldoCheck = document.getElementById('filter-saldo');
      const saldoDefCheck = document.getElementById('filter-saldodef');
      const scrapCheck = document.getElementById('filter-scrap');
      const sortSelect = document.getElementById('quick-sort');
      
      if (searchInput) searchInput.value = '';
      if (saldoCheck) saldoCheck.checked = false;
      if (saldoDefCheck) saldoDefCheck.checked = false;
      if (scrapCheck) scrapCheck.checked = false;
      if (sortSelect) sortSelect.value = '';
      
      State.tablePager.page = 1;
      UI.updateActiveFiltersDisplay();
      UI.renderDashboard();
      Utils.showToast('Filtros limpos', 'info');
    },
    
    updateActiveFiltersDisplay: () => {
      const container = document.getElementById('active-filters');
      const listEl = document.getElementById('active-filters-list');
      if (!container || !listEl) return;
      
      const { search, saldo, saldoDef, scrap, sort } = State.quickFilters;
      const activeFilters = [];
      
      if (search) activeFilters.push(`Busca: "${search}"`);
      if (saldo) activeFilters.push('Saldo > 0');
      if (saldoDef) activeFilters.push('Saldo Def > 0');
      if (scrap) activeFilters.push('Scrap > 0');
      if (sort) {
        const sortLabels = {
          'saldodef_desc': 'Maior Saldo Defeito',
          'date_desc': 'Mais recente',
          'date_asc': 'Mais antigo'
        };
        activeFilters.push(`Ordenar: ${sortLabels[sort] || sort}`);
      }
      
      if (activeFilters.length > 0) {
        listEl.innerHTML = activeFilters.map(f => 
          `<span class="filter-tag">${f} <i class="ph-bold ph-x" onclick="ToyotaQC.UI.removeFilter()"></i></span>`
        ).join('');
        container.classList.remove('hidden');
      } else {
        container.classList.add('hidden');
      }
    },
    
    removeFilter: () => {
      UI.clearQuickFilters();
    },

    initTheme: () => {
      const saved = localStorage.getItem('toyota_theme');
      UI.applyTheme(saved === 'dark' ? 'dark' : 'light');
    },

    applyTheme: (theme) => {
      const root = document.documentElement;
      const isDark = theme === 'dark';
      root.classList.toggle('dark', isDark);
      localStorage.setItem('toyota_theme', isDark ? 'dark' : 'light');
      State.isDarkMode = isDark;

      const ico = document.getElementById('theme-ico');
      const txtEl = document.getElementById('theme-txt');
      if (ico && txtEl) {
        ico.className = isDark ? 'ph-bold ph-sun' : 'ph-bold ph-moon';
        txtEl.textContent = isDark ? 'Claro' : 'Escuro';
      }
      UI.refreshChartsTheme();
    },

    refreshChartsTheme: () => {
      // Atualizar cores dos gráficos existentes
      const textColor = Charts.getTextColor();
      const gridColor = Charts.getGridColor();
      
      // Função para atualizar um gráfico
      const updateChartColors = (chart) => {
        if (!chart) return;
        
        // Atualizar cor do texto dos eixos
        if (chart.options.scales?.x?.ticks) {
          chart.options.scales.x.ticks.color = textColor;
        }
        if (chart.options.scales?.y?.ticks) {
          chart.options.scales.y.ticks.color = textColor;
        }
        if (chart.options.scales?.y1?.ticks) {
          chart.options.scales.y1.ticks.color = textColor;
        }
        
        // Atualizar cor do grid
        if (chart.options.scales?.x?.grid) {
          chart.options.scales.x.grid.color = gridColor;
        }
        if (chart.options.scales?.y?.grid) {
          chart.options.scales.y.grid.color = gridColor;
        }
        
        // Atualizar cor da legenda
        if (chart.options.plugins?.legend?.labels) {
          chart.options.plugins.legend.labels.color = textColor;
        }
        
        // Forçar update
        chart.update();
      };
      
      // Atualizar todos os gráficos
      updateChartColors(State.charts.pareto);
      updateChartColors(State.charts.status);
      updateChartColors(State.charts.defectByPN);
      updateChartColors(State.charts.missingCheck);
      updateChartColors(State.charts.areaChart);
      updateChartColors(State.charts.comparativeChart);
    },

    bindEvents: () => {
      document.getElementById('btn-theme')?.addEventListener('click', () => UI.applyTheme(State.isDarkMode ? 'light' : 'dark'));
      document.getElementById('btn-open-sheet')?.addEventListener('click', () => UI.openLoginModal());
      document.getElementById('btn-refresh-now')?.addEventListener('click', () => UI.manualRefresh());
      document.getElementById('conn-banner-close')?.addEventListener('click', () => UI.hideConnBanner());
      document.getElementById('btn-manual')?.addEventListener('click', () => UI.openManualModal());

      document.getElementById('login-close')?.addEventListener('click', () => UI.closeLoginModal());
      document.getElementById('login-cancel')?.addEventListener('click', () => UI.closeLoginModal());
      
      document.getElementById('login-google')?.addEventListener('click', () => {
        UI.closeLoginModal();
        window.open(CONFIG.SHEET_OPEN_URL, '_blank', 'noopener,noreferrer');
      });

      document.getElementById('flt-day')?.addEventListener('change', (e) => {
        State.checkedFilter.day = e.target.value;
        State.tablePager.page = 1;
        UI.renderDashboard();
      });

      document.getElementById('flt-month')?.addEventListener('change', (e) => {
        State.checkedFilter.month = e.target.value;
        UI.syncDayOptions();
        State.tablePager.page = 1;
        UI.renderDashboard();
      });

      document.getElementById('flt-year')?.addEventListener('change', (e) => {
        State.checkedFilter.year = e.target.value;
        UI.syncDayOptions();
        State.tablePager.page = 1;
        UI.renderDashboard();
      });

      document.getElementById('flt-clear')?.addEventListener('click', () => {
        State.checkedFilter = { day: '', month: '', year: '' };
        UI.setFilterSelects();
        UI.syncDayOptions();
        State.tablePager.page = 1;
        UI.renderDashboard();
      });

      document.getElementById('tbl-page-size')?.addEventListener('change', (e) => {
        State.tablePager.pageSize = parseInt(e.target.value, 10) || 100;
        State.tablePager.page = 1;
        localStorage.setItem('toyota_pageSize', State.tablePager.pageSize);
        UI.renderDashboard();
      });

      document.getElementById('tbl-prev')?.addEventListener('click', () => {
        if (State.tablePager.page > 1) { State.tablePager.page--; UI.renderDashboardTableOnly(); }
      });

      document.getElementById('tbl-next')?.addEventListener('click', () => {
        if (State.tablePager.page < State.tablePager.totalPages) { State.tablePager.page++; UI.renderDashboardTableOnly(); }
      });

      document.getElementById('missingcheck-sort')?.addEventListener('change', () => {
        if (State.currentScreen === 'missingcheck') UI.renderMissingCheckScreen();
      });

      // Eventos para os botões de expandir/recolher
      document.getElementById('toggle-area-card')?.addEventListener('click', () => UI.toggleAreaCard());
      document.getElementById('toggle-comparative-card')?.addEventListener('click', () => UI.toggleComparativeCard());

      // Eventos para o gráfico comparativo
      document.getElementById('comparative-view')?.addEventListener('change', (e) => {
        State.comparativeChart.view = e.target.value;
        UI.updateComparativeChart();
      });

      document.getElementById('comparative-year')?.addEventListener('change', (e) => {
        State.comparativeChart.year = parseInt(e.target.value);
        UI.updateComparativeChart();
      });
    },

    updateConnectionStatus: () => {
      const pulse = document.getElementById('conn-status-pulse');
      const dot = document.getElementById('conn-status-dot');
      const text = document.getElementById('conn-status-text');
      const sourceInfo = document.getElementById('data-source-info');
      
      if (!pulse || !dot || !text) return;
      
      pulse.className = 'absolute inline-flex h-full w-full rounded-full opacity-75';
      dot.className = 'relative inline-flex rounded-full h-2 w-2';
      document.body.classList.remove('conn-status-online', 'conn-status-cache', 'conn-status-offline');
      
      switch(State.connectionStatus) {
        case 'online':
          pulse.classList.add('bg-green-400');
          dot.classList.add('bg-green-500');
          text.textContent = 'Online';
          document.body.classList.add('conn-status-online');
          if (sourceInfo) sourceInfo.textContent = 'Fonte: Google Sheets (tempo real)';
          break;
        case 'cache':
          pulse.classList.add('bg-yellow-400');
          dot.classList.add('bg-yellow-500');
          text.textContent = 'Cache';
          document.body.classList.add('conn-status-cache');
          if (sourceInfo) sourceInfo.textContent = 'Fonte: Cache local';
          break;
        case 'offline':
          pulse.classList.add('bg-red-400');
          dot.classList.add('bg-red-500');
          text.textContent = 'Falha';
          document.body.classList.add('conn-status-offline');
          if (sourceInfo) sourceInfo.textContent = 'Fonte: Offline';
          break;
      }
    },

    showConnBanner: (title, message, tech = '') => {
      const box = document.getElementById('conn-banner');
      if (!box) return;
      document.getElementById('conn-banner-title').textContent = title || 'Falha ao carregar dados';
      document.getElementById('conn-banner-msg').textContent = message;
      document.getElementById('conn-banner-tech').textContent = tech ? `Detalhe: ${tech}` : '';
      box.classList.remove('hidden');
    },

    hideConnBanner: () => document.getElementById('conn-banner')?.classList.add('hidden'),

    updateLastUpdate: (text) => {
      const el = document.getElementById('last-update-txt');
      if (!el) return;
      
      const now = new Date();
      State.lastUpdateTimestamp = now;
      
      el.innerText = text 
        ? text 
        : `Atualizado: ${Utils.formatDateFull(now)}`;
    },

    openLoginModal: () => {
      const modal = document.getElementById('login-modal');
      if (!modal) return;
      modal.classList.remove('hidden');
      modal.classList.add('flex');
      document.getElementById('login-err')?.classList.add('hidden');
    },

    closeLoginModal: () => {
      const modal = document.getElementById('login-modal');
      if (!modal) return;
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    },

    openManualModal: () => {
      let modal = document.getElementById('manual-modal');
      if (!modal) modal = UI.createManualModal();
      modal.classList.remove('hidden');
      modal.classList.add('flex');
    },

    closeManualModal: () => {
      const modal = document.getElementById('manual-modal');
      if (modal) { modal.classList.add('hidden'); modal.classList.remove('flex'); }
    },

    createManualModal: () => {
      const modal = document.createElement('div');
      modal.id = 'manual-modal';
      modal.className = 'hidden absolute inset-0 bg-black/60 z-[999] items-center justify-center p-4';
      modal.innerHTML = `
        <div class="w-full max-w-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl shadow-xl p-5 max-h-[80vh] overflow-y-auto">
          <div class="flex items-center justify-between sticky top-0 bg-white dark:bg-gray-900 pb-3 border-b border-gray-200 dark:border-gray-800">
            <h3 class="text-lg font-extrabold text-gray-800 dark:text-gray-100 flex items-center gap-2">
              <i class="ph-bold ph-book text-toyota-red"></i>
              Manual do Sistema ${CONFIG.VERSION}
            </h3>
            <button onclick="ToyotaQC.UI.closeManualModal()" class="text-gray-500 hover:text-toyota-red">
              <i class="ph-bold ph-x"></i>
            </button>
          </div>

          <div class="mt-4 space-y-4">
            <div class="manual-section">
              <h4>📊 Visão Geral</h4>
              <p class="text-sm text-gray-600 dark:text-gray-300">Dashboard para monitoramento da qualidade das prensas. Os dados são carregados automaticamente a cada 10 minutos da planilha Google Sheets.</p>
            </div>

            <div class="manual-section">
              <h4>🎯 Navegação</h4>
              <ul class="list-disc list-inside text-sm text-gray-600 dark:text-gray-300 space-y-1">
                <li><span class="font-bold">Menu principal</span>: Selecione uma linha de produção específica ou visão geral</li>
                <li><span class="font-bold">Botão "Abrir Planilha"</span>: Acessa a planilha fonte (requer login Google)</li>
                <li><span class="font-bold">Botão "Backup"</span>: Cria e gerencia backups dos dados</li>
                <li><span class="font-bold">Botão "Área"</span>: Visualiza detalhamento da área do reparo</li>
                <li><span class="font-bold">Clique no Pareto</span>: Clique em qualquer barra do gráfico Pareto para ver detalhes do defeito</li>
                <li><span class="font-bold">Busca rápida</span>: Pesquise por PN, Die, Defeito ou Quem reparou</li>
                <li><span class="font-bold">Filtros de saldo</span>: Filtre rapidamente por saldo >0, saldoDef >0 ou scrap >0</li>
                <li><span class="font-bold">Gráficos na página inicial</span>: Área do reparo e comparativo anual/mensal</li>
                <li><span class="font-bold">Expandir/Recolher</span>: Use os botões "X" para fechar gráficos e o botão "+" para reabri-los</li>
              </ul>
            </div>

            <div class="manual-section">
              <h4>💾 Backup e Restauração</h4>
              <p class="text-sm text-gray-600 dark:text-gray-300">O sistema permite:</p>
              <ul class="list-disc list-inside text-sm text-gray-600 dark:text-gray-300 mt-1">
                <li><span class="font-bold">Criar Backup</span>: Salva os dados atuais em arquivo JSON</li>
                <li><span class="font-bold">Restaurar Backup</span>: Carrega dados de um arquivo JSON salvo anteriormente</li>
                <li><span class="font-bold">Gerenciar Backups</span>: Visualiza, baixa novamente ou remove backups da lista</li>
                <li><span class="font-bold">Cache automático</span>: Os 3 backups mais recentes ficam em cache para download rápido</li>
                <li><span class="font-bold">Atalho</span>: Ctrl + B para abrir o gerenciador de backup</li>
              </ul>
            </div>

            <div class="manual-section">
              <h4>⌨️ Atalhos de Teclado</h4>
              <div class="grid grid-cols-2 gap-2 text-sm">
                <div><span class="keyboard-shortcut">Ctrl + R</span> Atualizar dados</div>
                <div><span class="keyboard-shortcut">Ctrl + L</span> Limpar filtros</div>
                <div><span class="keyboard-shortcut">Ctrl + B</span> Abrir backup</div>
                <div><span class="keyboard-shortcut">Esc</span> Fechar modais</div>
                <div><span class="keyboard-shortcut">?</span> Abrir este manual</div>
                <div><span class="keyboard-shortcut">Ctrl + H</span> Abrir ajuda</div>
              </div>
            </div>

            <div class="manual-section">
              <h4>📈 KPIs de Gestão</h4>
              <p class="text-sm text-gray-600 dark:text-gray-300">O dashboard mostra:</p>
              <ul class="list-disc list-inside text-sm text-gray-600 dark:text-gray-300 mt-1">
                <li><span class="font-bold">Top 1 defeito</span> do dia/semana com impacto</li>
                <li><span class="font-bold">Top 3 PNs críticos</span> (base saldo defeito)</li>
                <li><span class="font-bold">% retrabalho</span> = reparos / checados</li>
                <li><span class="font-bold">% scrap</span> = scrap / checados</li>
                <li><span class="font-bold">Área do reparo</span> com detalhamento por produto</li>
                <li><span class="font-bold">Gráfico comparativo</span>: Saldo Defeito vs Scrap (mensal/anual)</li>
              </ul>
            </div>

          <div class="mt-6 pt-3 border-t border-gray-200 dark:border-gray-800 flex justify-between items-center">
            <span class="text-[10px] text-gray-400">Versão: ${CONFIG.VERSION}</span>
            <button onclick="ToyotaQC.UI.closeManualModal()" class="px-4 py-2 bg-toyota-red text-white rounded-lg text-sm font-bold hover:brightness-95 transition">
              Entendi
            </button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
      return modal;
    },

    startUpdateCycle: () => {
      DataManager.fetchData(false);

      if (State.intervalRef) clearInterval(State.intervalRef);
      State.intervalRef = setInterval(() => {
        State.timer--;
        const pct = ((CONFIG.UPDATE_INTERVAL - State.timer) / CONFIG.UPDATE_INTERVAL) * 100;
        const bar = document.getElementById('progress-bar');
        if (bar) bar.style.width = `${pct}%`;

        if (State.timer <= 0) {
          State.timer = CONFIG.UPDATE_INTERVAL;
          DataManager.fetchData(false);
        }

        if (State.manualCooldownLeft > 0) {
          State.manualCooldownLeft--;
          UI.updateManualButtonState();
        }
      }, 1000);

      UI.updateManualButtonState();
    },

    manualRefresh: () => {
      if (State.manualCooldownLeft > 0 || State.isFetching) return;

      const ok = confirm(
        "⚠️ ATENÇÃO:\n" +
        "Evite clicar muitas vezes em 'Atualizar agora'.\n" +
        "Isso pode derrubar a conexão com o Google por excesso de requisições.\n\n" +
        "Deseja atualizar agora?"
      );
      if (!ok) return;

      State.manualCooldownLeft = CONFIG.MANUAL_COOLDOWN;
      UI.updateManualButtonState();
      State.timer = CONFIG.UPDATE_INTERVAL;
      const bar = document.getElementById('progress-bar');
      if (bar) bar.style.width = '0%';
      DataManager.fetchData(true);
    },

    updateManualButtonState: () => {
      const btn = document.getElementById('btn-refresh-now');
      const txtEl = document.getElementById('btn-refresh-text');
      if (!btn || !txtEl) return;

      if (State.manualCooldownLeft > 0) {
        btn.classList.add('btn-disabled');
        btn.disabled = true;
        const mm = Math.floor(State.manualCooldownLeft / 60);
        const ss = State.manualCooldownLeft % 60;
        txtEl.textContent = `Aguarde ${Utils.pad2(mm)}:${Utils.pad2(ss)}`;
      } else {
        btn.classList.remove('btn-disabled');
        btn.disabled = false;
        txtEl.textContent = 'Atualizar agora';
      }
    },

    renderMenuSummary: () => {
      // Remover botões ao entrar no menu
      UI.removeBackupButtons();
      
      let saldoTotal = 0;
      let saldoDefTotal = 0;
      let minD = null;
      let maxD = null;

      for (const row of State.data) {
        const saldo = Utils.int(row[COL.saldo]);
        const saldoDef = Utils.int(row[COL.saldoDef]);

        if (saldo > 0) {
          saldoTotal += saldo;
          const d = Utils.parseDateBR(row[COL.data]);
          if (d) { 
            if (!minD || d < minD) minD = d; 
            if (!maxD || d > maxD) maxD = d; 
          }
        }
        if (saldoDef > 0) saldoDefTotal += saldoDef;
      }

      document.getElementById('menu-saldo-total').textContent = (saldoTotal || 0).toLocaleString();
      document.getElementById('menu-saldodefeito-total').textContent = (saldoDefTotal || 0).toLocaleString();

      const rangeEl = document.getElementById('menu-range-total');
      const rangeDetailsEl = document.getElementById('menu-range-details');
      
      if (saldoTotal > 0 && minD && maxD) {
        rangeEl.textContent = `De ${Utils.formatDateShort(minD)} até ${Utils.formatDateShort(maxD)}`;
        if (rangeDetailsEl) {
          rangeDetailsEl.textContent = `min: ${Utils.formatDateShort(minD)} | max: ${Utils.formatDateShort(maxD)}`;
        }
      } else {
        rangeEl.textContent = saldoTotal > 0 ? 'Período: (sem data válida)' : 'Sem pendências';
        if (rangeDetailsEl) rangeDetailsEl.textContent = 'min: -- | max: --';
      }
      
      // Renderizar gráficos da página inicial
      UI.renderMenuCharts();
    },
    
    // ✅ Renderizar gráficos na página inicial - AGORA RECOLHE O CARD INTEIRO
    renderMenuCharts: () => {
      if (!State.data || State.data.length === 0) return;
      
      // Calcular área do reparo se não tiver sido calculada ainda
      if (!State.areaDetails.items || State.areaDetails.items.length === 0) {
        const areaResult = DataManager.computeRepairArea(State.data);
        State.areaDetails = {
          ...areaResult,
          lastUpdate: new Date()
        };
      }
      
      // Container dos gráficos
      const chartsContainer = document.getElementById('menu-charts-container');
      if (!chartsContainer) return;
      
      let html = '';
      
      // Card da Área - AGORA OCULTA O CARD INTEIRO QUANDO RECOLHIDO
      if (State.menuCards.areaExpanded) {
        html += `
          <div class="bg-white dark:bg-gray-900 rounded-xl shadow-md border border-gray-200 dark:border-gray-800 overflow-hidden">
            <div class="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
              <h3 class="text-sm font-bold text-gray-700 dark:text-gray-300 flex items-center gap-2">
                <i class="ph-bold ph-map-trifold text-blue-600"></i>
                Área do Reparo
              </h3>
              <div class="flex items-center gap-2">
                <button onclick="ToyotaQC.UI.openAreaModal()" class="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1 px-2 py-1 rounded hover:bg-blue-50 dark:hover:bg-blue-900/30">
                  <i class="ph-bold ph-arrow-square-out"></i>
                  Detalhes
                </button>
                <button id="toggle-area-card" onclick="ToyotaQC.UI.toggleAreaCard()" class="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700">
                  <i class="ph-bold ph-minus-circle"></i>
                </button>
              </div>
            </div>
            <div class="p-3">
              <div class="h-48">
                <canvas id="chartArea"></canvas>
              </div>
            </div>
          </div>
        `;
      } else {
        html += `
          <div class="bg-white dark:bg-gray-900 rounded-xl shadow-md border border-gray-200 dark:border-gray-800 overflow-hidden">
            <div class="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
              <h3 class="text-sm font-bold text-gray-700 dark:text-gray-300 flex items-center gap-2">
                <i class="ph-bold ph-map-trifold text-blue-600"></i>
                Área do Reparo
              </h3>
              <div class="flex items-center gap-2">
                <button onclick="ToyotaQC.UI.openAreaModal()" class="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1 px-2 py-1 rounded hover:bg-blue-50 dark:hover:bg-blue-900/30">
                  <i class="ph-bold ph-arrow-square-out"></i>
                  Detalhes
                </button>
                <button id="toggle-area-card" onclick="ToyotaQC.UI.toggleAreaCard()" class="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700">
                  <i class="ph-bold ph-plus-circle"></i>
                </button>
              </div>
            </div>
            <div class="p-8 text-center">
              <p class="text-sm text-gray-500">Card recolhido. Clique no <i class="ph-bold ph-plus-circle"></i> para expandir.</p>
            </div>
          </div>
        `;
      }
      
      // Card Comparativo - AGORA OCULTA O CARD INTEIRO QUANDO RECOLHIDO
      if (State.menuCards.comparativeExpanded) {
        html += `
          <div class="bg-white dark:bg-gray-900 rounded-xl shadow-md border border-gray-200 dark:border-gray-800 overflow-hidden">
            <div class="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
              <h3 class="text-sm font-bold text-gray-700 dark:text-gray-300 flex items-center gap-2">
                <i class="ph-bold ph-chart-bar text-toyota-red"></i>
                Comparativo: Saldo Defeito vs Scrap
              </h3>
              <div class="flex items-center gap-2">
                <div class="flex items-center gap-1">
                  <select id="comparative-view" class="text-xs border border-gray-300 dark:border-gray-700 rounded-lg px-2 py-1 bg-white dark:bg-gray-800">
                    <option value="monthly" ${State.comparativeChart.view === 'monthly' ? 'selected' : ''}>Mensal</option>
                    <option value="yearly" ${State.comparativeChart.view === 'yearly' ? 'selected' : ''}>Anual</option>
                  </select>
                  <select id="comparative-year" class="text-xs border border-gray-300 dark:border-gray-700 rounded-lg px-2 py-1 bg-white dark:bg-gray-800">
                    <!-- Preenchido via JavaScript -->
                  </select>
                </div>
                <button id="toggle-comparative-card" onclick="ToyotaQC.UI.toggleComparativeCard()" class="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700">
                  <i class="ph-bold ph-minus-circle"></i>
                </button>
              </div>
            </div>
            <div class="p-3">
              <div class="h-80">
                <canvas id="chartComparative"></canvas>
              </div>
            </div>
          </div>
        `;
      } else {
        html += `
          <div class="bg-white dark:bg-gray-900 rounded-xl shadow-md border border-gray-200 dark:border-gray-800 overflow-hidden">
            <div class="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
              <h3 class="text-sm font-bold text-gray-700 dark:text-gray-300 flex items-center gap-2">
                <i class="ph-bold ph-chart-bar text-toyota-red"></i>
                Comparativo: Saldo Defeito vs Scrap
              </h3>
              <div class="flex items-center gap-2">
                <div class="flex items-center gap-1">
                  <select id="comparative-view" class="text-xs border border-gray-300 dark:border-gray-700 rounded-lg px-2 py-1 bg-white dark:bg-gray-800">
                    <option value="monthly" ${State.comparativeChart.view === 'monthly' ? 'selected' : ''}>Mensal</option>
                    <option value="yearly" ${State.comparativeChart.view === 'yearly' ? 'selected' : ''}>Anual</option>
                  </select>
                  <select id="comparative-year" class="text-xs border border-gray-300 dark:border-gray-700 rounded-lg px-2 py-1 bg-white dark:bg-gray-800">
                    <!-- Preenchido via JavaScript -->
                  </select>
                </div>
                <button id="toggle-comparative-card" onclick="ToyotaQC.UI.toggleComparativeCard()" class="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700">
                  <i class="ph-bold ph-plus-circle"></i>
                </button>
              </div>
            </div>
            <div class="p-8 text-center">
              <p class="text-sm text-gray-500">Card recolhido. Clique no <i class="ph-bold ph-plus-circle"></i> para expandir.</p>
            </div>
          </div>
        `;
      }
      
      chartsContainer.innerHTML = html;
      
      // Renderizar gráfico da área apenas se expandido
      if (State.menuCards.areaExpanded) {
        const areaCanvas = document.getElementById('chartArea');
        if (areaCanvas) {
          const ctx = areaCanvas.getContext('2d');
          State.charts.areaChart = Charts.createAreaChart(ctx, State.areaDetails);
        }
      }
      
      // Renderizar gráfico comparativo apenas se expandido
      if (State.menuCards.comparativeExpanded) {
        const comparativeCanvas = document.getElementById('chartComparative');
        if (comparativeCanvas) {
          const ctx = comparativeCanvas.getContext('2d');
          State.charts.comparativeChart = Charts.createComparativeChart(ctx, State.data);
        }
      }
      
      // Preencher seletor de anos
      UI.fillYearSelector();
      
      // Re-bind dos eventos dos selects
      document.getElementById('comparative-view')?.addEventListener('change', (e) => {
        State.comparativeChart.view = e.target.value;
        UI.updateComparativeChart();
      });

      document.getElementById('comparative-year')?.addEventListener('change', (e) => {
        State.comparativeChart.year = parseInt(e.target.value);
        UI.updateComparativeChart();
      });
    },
    
    // Preencher seletor de anos no gráfico comparativo
    fillYearSelector: () => {
      const yearSelect = document.getElementById('comparative-year');
      if (!yearSelect) return;
      
      const years = DataManager.getAvailableYears();
      
      // Se não houver anos, mostrar apenas o ano atual
      if (years.length === 0) {
        yearSelect.innerHTML = `<option value="${new Date().getFullYear()}">${new Date().getFullYear()}</option>`;
        return;
      }
      
      yearSelect.innerHTML = years.map(year => 
        `<option value="${year}" ${year === State.comparativeChart.year ? 'selected' : ''}>${year}</option>`
      ).join('');
    },
    
    // Atualizar gráfico comparativo
    updateComparativeChart: () => {
      if (!State.menuCards.comparativeExpanded) return;
      
      const canvas = document.getElementById('chartComparative');
      if (!canvas) return;
      
      const ctx = canvas.getContext('2d');
      State.charts.comparativeChart = Charts.createComparativeChart(ctx, State.data);
    },

    selectPN: (filter) => {
      State.currentFilter = filter === 'GERAL' ? null : filter;
      State.currentScreen = 'dashboard';
      State.tablePager.page = 1;

      document.getElementById('screen-menu').classList.add('hidden');
      document.getElementById('screen-dashboard').classList.remove('hidden');
      document.getElementById('screen-defect').classList.add('hidden');
      document.getElementById('screen-missingcheck').classList.add('hidden');

      const title = document.getElementById('dash-title');
      title.innerText = (filter === 'GERAL') ? "VISÃO GERAL (TODOS)" : "MONITORAMENTO: " + filter.join(' / ');

      // Criar botões na visão geral
      UI.createBackupButtons();
      
      UI.renderDashboard();
    },

    backToMenu: () => {
      State.currentScreen = 'menu';
      document.getElementById('screen-dashboard').classList.add('hidden');
      document.getElementById('screen-defect').classList.add('hidden');
      document.getElementById('screen-missingcheck').classList.add('hidden');
      document.getElementById('screen-menu').classList.remove('hidden');
      State.currentFilter = null;
      State.currentDefectKey = null;
      
      // Remover botões ao voltar ao menu
      UI.removeBackupButtons();
      
      UI.renderMenuSummary();
    },

    openDefectScreen: (defectKey) => {
      State.currentDefectKey = defectKey;
      State.currentScreen = 'defect';
      document.getElementById('screen-dashboard').classList.add('hidden');
      document.getElementById('screen-defect').classList.remove('hidden');
      document.getElementById('screen-missingcheck').classList.add('hidden');
      
      // Remover botões
      UI.removeBackupButtons();
      
      UI.renderDefectScreen(defectKey);
    },

    backToDashboardFromDefect: () => {
      State.currentScreen = 'dashboard';
      document.getElementById('screen-defect').classList.add('hidden');
      document.getElementById('screen-dashboard').classList.remove('hidden');
      
      // Recriar botões
      UI.createBackupButtons();
    },

    openMissingCheckScreen: () => {
      State.currentScreen = 'missingcheck';
      document.getElementById('screen-menu').classList.add('hidden');
      document.getElementById('screen-dashboard').classList.add('hidden');
      document.getElementById('screen-defect').classList.add('hidden');
      document.getElementById('screen-missingcheck').classList.remove('hidden');
      
      // Remover botões
      UI.removeBackupButtons();
      
      UI.renderMissingCheckScreen();
    },

    backToMenuFromMissingCheck: () => {
      State.currentScreen = 'menu';
      document.getElementById('screen-missingcheck').classList.add('hidden');
      document.getElementById('screen-menu').classList.remove('hidden');
      
      // Remover botões
      UI.removeBackupButtons();
      
      UI.renderMenuSummary();
    },

    updateScreen: () => {
      switch (State.currentScreen) {
        case 'dashboard': 
          UI.renderDashboard(); 
          UI.createBackupButtons(); // Garantir que botões existem
          break;
        case 'defect': 
          if (State.currentDefectKey) UI.renderDefectScreen(State.currentDefectKey); 
          break;
        case 'missingcheck': 
          UI.renderMissingCheckScreen(); 
          break;
        default: 
          UI.renderMenuSummary();
      }
    },

    buildCheckedFilterOptions: () => {
      const years = new Set();
      const months = new Set();

      for (const row of State.data) {
        const d = Utils.parseDateBR(row[COL.data]);
        if (!d) continue;
        years.add(String(d.getFullYear()));
        months.add(String(d.getMonth() + 1).padStart(2, '0'));
      }

      UI.fillSelect('flt-year', [...years].sort((a,b)=>Number(a)-Number(b)), State.checkedFilter.year, true);
      UI.fillSelect('flt-month', [...months].sort((a,b)=>Number(a)-Number(b)), State.checkedFilter.month, true);

      UI.syncDayOptions();
      UI.setFilterSelects();
    },

    syncDayOptions: () => {
      const { year, month } = State.checkedFilter;
      const days = new Set();

      for (const row of State.data) {
        const d = Utils.parseDateBR(row[COL.data]);
        if (!d) continue;

        const yy = String(d.getFullYear());
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');

        if (year && yy !== year) continue;
        if (month && mm !== month) continue;

        days.add(dd);
      }

      const dayList = [...days].sort((a,b)=>Number(a)-Number(b));
      if (State.checkedFilter.day && !days.has(State.checkedFilter.day)) State.checkedFilter.day = '';

      UI.fillSelect('flt-day', dayList, State.checkedFilter.day, true);
      UI.setFilterSelects();
    },

    fillSelect: (id, options, selected, keepAllOption) => {
      const sel = document.getElementById(id);
      if (!sel) return;
      const first = keepAllOption ? `<option value="">Todos</option>` : '';
      sel.innerHTML = first + options.map(v => `<option value="${v}">${v}</option>`).join('');
      sel.value = selected || '';
    },

    setFilterSelects: () => {
      document.getElementById('flt-day').value = State.checkedFilter.day || '';
      document.getElementById('flt-month').value = State.checkedFilter.month || '';
      document.getElementById('flt-year').value = State.checkedFilter.year || '';
      UI.setCheckedHint();
    },

    setCheckedHint: () => {
      const parts = [];
      if (State.checkedFilter.day) parts.push(`Dia ${State.checkedFilter.day}`);
      if (State.checkedFilter.month) parts.push(`Mês ${State.checkedFilter.month}`);
      if (State.checkedFilter.year) parts.push(`Ano ${State.checkedFilter.year}`);
      document.getElementById('kpi-checked-hint').textContent = parts.length ? `Filtro: ${parts.join(' • ')}` : 'Filtro: Todos';
    },

    checkAlerts: () => {
      if (!State.lastFilteredData || State.lastFilteredData.length === 0) return;
      
      const stats = DataManager.computeStats(State.lastFilteredData);
      
      if (State.previousStats) {
        const currentDefects = stats.defectTypes;
        const prevDefects = State.previousStats.defectTypes;
        
        for (const [defect, qty] of Object.entries(currentDefects)) {
          const prevQty = prevDefects[defect] || 0;
          if (prevQty > 0 && qty / prevQty > CONFIG.SPIKE_THRESHOLD) {
            State.alerts.spike = defect;
            break;
          }
        }
      }
      
      UI.updateAlertIndicators(stats);
    },
    
    updateAlertIndicators: () => {
      // Função vazia - alertas removidos
    },

    renderDashboard: () => {
      if (!State.data.length) return;

      let pnFiltered = State.data;
      if (State.currentFilter) pnFiltered = State.data.filter(row => DataManager.matchesFamily(row[COL.part] || '', State.currentFilter));

      pnFiltered = [...pnFiltered].reverse();
      
      pnFiltered = DataManager.applyQuickFilters(pnFiltered);
      
      const dateFiltered = DataManager.applyDateFilter(pnFiltered);
      State.lastFilteredData = dateFiltered;

      const stats = DataManager.computeStats(dateFiltered);

      const filteredChecked = dateFiltered.reduce((sum, row) => {
        return sum + Utils.int(row[COL.chec1]) + Utils.int(row[COL.chec2]) + Utils.int(row[COL.chec3]);
      }, 0);

      document.getElementById('kpi-checked').innerText = filteredChecked.toLocaleString();
      document.getElementById('kpi-defects').innerText = stats.saldoDef.toLocaleString();
      document.getElementById('kpi-repairs').innerText = stats.repairs.toLocaleString();
      document.getElementById('kpi-scrap').innerText = stats.scrap.toLocaleString();
      
      document.getElementById('pct-retrabalho').innerText = `${stats.reworkPct}% retrabalho`;
      document.getElementById('pct-scrap').innerText = `${stats.scrapPct}% scrap`;
      
      UI.setCheckedHint();

      UI.renderTopDefectAndPNs(stats, dateFiltered);

      // FILTRO: Manter apenas linhas com qtdCheck > 0 para a tabela
      const qtdCheckFiltered = dateFiltered.filter(row => {
        const qtdCheck = Utils.int(row[COL.qtdCheck]);
        return qtdCheck > 0;
      });

      State.tablePager.totalRows = qtdCheckFiltered.length;
      State.tablePager.totalPages = Math.max(1, Math.ceil(State.tablePager.totalRows / State.tablePager.pageSize));
      if (State.tablePager.page > State.tablePager.totalPages) State.tablePager.page = State.tablePager.totalPages;
      if (State.tablePager.page < 1) State.tablePager.page = 1;

      UI.renderTablePage(qtdCheckFiltered); // Passar os dados filtrados
      UI.updateTablePagerUI();
      UI.updateCharts(stats);
      
      // Calcular área do reparo e salvar detalhes
      const areaResult = DataManager.computeRepairArea(dateFiltered);
      State.areaDetails = {
        ...areaResult,
        lastUpdate: new Date()
      };

      UI.checkAlerts();
    },
    
    renderTopDefectAndPNs: (stats, data) => {
      const topDefect = DataManager.getTopDefect(stats);
      const topPNs = DataManager.getTopPNs(data);
      
      const top1Container = document.getElementById('top1-defeito-content');
      if (top1Container) {
        if (topDefect) {
          top1Container.innerHTML = `
            <div class="text-center">
              <p class="text-sm font-bold text-toyota-red">${topDefect.name}</p>
              <p class="text-2xl font-black text-gray-800 dark:text-gray-100">${Utils.formatNumber(topDefect.qty)}</p>
              <p class="text-[10px] text-gray-400">Saldo Defeito</p>
            </div>
          `;
        } else {
          top1Container.innerHTML = '<p class="text-xs text-gray-500">Nenhum defeito registrado</p>';
        }
      }
      
      const top3Container = document.getElementById('top3-pns-content');
      if (top3Container) {
        if (topPNs.length > 0) {
          top3Container.innerHTML = topPNs.map((pn, idx) => `
            <div class="text-center p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
              <div class="flex items-center justify-center gap-1 mb-1">
                <span class="position-badge position-${idx+1}">${idx+1}</span>
                <span class="font-bold text-sm">${pn.pn}</span>
              </div>
              <p class="text-lg font-black text-red-600 dark:text-red-500">${Utils.formatNumber(pn.qty)}</p>
              <p class="text-[9px] text-gray-400">Total Reparos</p>
            </div>
          `).join('');
        } else {
          top3Container.innerHTML = '<p class="text-xs text-gray-500 col-span-3 text-center">Nenhum PN com reparos</p>';
        }
      }
    },

    renderDashboardTableOnly: () => {
      if (!State.data.length) return;

      let pnFiltered = State.data;
      if (State.currentFilter) pnFiltered = State.data.filter(row => DataManager.matchesFamily(row[COL.part] || '', State.currentFilter));

      pnFiltered = [...pnFiltered].reverse();
      
      pnFiltered = DataManager.applyQuickFilters(pnFiltered);
      
      const tableData = DataManager.applyDateFilter(pnFiltered);

      // FILTRO: Manter apenas linhas com qtdCheck > 0
      const qtdCheckFiltered = tableData.filter(row => {
        const qtdCheck = Utils.int(row[COL.qtdCheck]);
        return qtdCheck > 0;
      });

      State.tablePager.totalRows = qtdCheckFiltered.length;
      State.tablePager.totalPages = Math.max(1, Math.ceil(State.tablePager.totalRows / State.tablePager.pageSize));
      if (State.tablePager.page > State.tablePager.totalPages) State.tablePager.page = State.tablePager.totalPages;
      if (State.tablePager.page < 1) State.tablePager.page = 1;

      UI.renderTablePage(qtdCheckFiltered);
      UI.updateTablePagerUI();
    },

    renderTablePage: (tableData) => {
      const tbody = document.getElementById('table-body');
      if (!tbody) return;

      const start = (State.tablePager.page - 1) * State.tablePager.pageSize;
      const end = start + State.tablePager.pageSize;
      const pageRows = tableData.slice(start, end);

      document.getElementById('table-count').innerText = `${tableData.length} Reg`;

      const fragment = document.createDocumentFragment();

      for (const row of pageRows) {
        const tipoDefRaw = Utils.txt(row[COL.tipoDef]);

        const chec1 = Utils.int(row[COL.chec1]);
        const chec2 = Utils.int(row[COL.chec2]);
        const chec3 = Utils.int(row[COL.chec3]);

        const rep1 = Utils.int(row[COL.rep1]);
        const rep2 = Utils.int(row[COL.rep2]);
        const rep3 = Utils.int(row[COL.rep3]);

        const scr1 = Utils.int(row[COL.scr1]);
        const scr2 = Utils.int(row[COL.scr2]);
        const scr3 = Utils.int(row[COL.scr3]);

        const who1 = Utils.txt(row[COL.who1]);
        const who2 = Utils.txt(row[COL.who2]);
        const who3 = Utils.txt(row[COL.who3]);

        const scrapTotal = Utils.int(row[COL.scrapTotal]) || (scr1 + scr2 + scr3);
        const saldo = Utils.int(row[COL.saldo]);
        const saldoDef = Utils.int(row[COL.saldoDef]);

        let trClass = "hover:bg-blue-50/30 dark:hover:bg-gray-800 transition-colors border-b border-gray-50 dark:border-gray-800";
        
        if (State.alerts.spike && Utils.normalizeDefect(tipoDefRaw) === State.alerts.spike) {
          trClass += " bg-red-50 dark:bg-red-950/20";
        }

        const tr = document.createElement('tr');
        tr.className = trClass;

        tr.innerHTML = `
          <td class="px-4 py-3 border-r border-gray-200 dark:border-gray-800 font-mono text-[10px] text-gray-500">${Utils.txt(row[COL.data])}</td>
          <td class="px-4 py-3 border-r border-gray-200 dark:border-gray-800 text-center"><span class="bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded text-[10px] font-bold">${Utils.txt(row[COL.turno])}</span></td>
          <td class="px-4 py-3 border-r border-gray-200 dark:border-gray-800 text-center font-mono text-[10px] text-gray-500">${Utils.txt(row[COL.die])}</td>
          
          <td class="px-4 py-3 border-r border-gray-200 dark:border-gray-800 font-bold text-gray-700 dark:text-gray-100">${Utils.txt(row[COL.part])}</td>
          
          <td class="px-4 py-3 border-r border-gray-200 dark:border-gray-800 text-center font-bold bg-gray-50/50 dark:bg-gray-800">${Utils.int(row[COL.qtdCheck])}</td>
          <td class="px-4 py-3 border-r border-gray-200 dark:border-gray-800 text-[10px] truncate max-w-[180px]" title="${tipoDefRaw}">${tipoDefRaw}</td>
          
          <!-- 1° TURNO -->
          <td class="px-2 py-3 border-r border-gray-200 dark:border-gray-800 text-center ${chec1 ? 'text-blue-400 font-bold' : 'text-gray-400'}">${chec1 || '-'}</td>
          <td class="px-2 py-3 border-r border-gray-200 dark:border-gray-800 text-center ${rep1 ? 'text-blue-600 font-bold' : 'text-gray-400'}">${rep1 || '-'}</td>
          <td class="px-2 py-3 border-r border-gray-200 dark:border-gray-800 text-center ${scr1 ? 'text-red-600 font-bold bg-red-50 dark:bg-red-950/30' : 'text-gray-400'}">${scr1 || '-'}</td>
          <td class="px-2 py-3 border-r border-gray-200 dark:border-gray-800 text-center text-[10px] text-gray-500">${who1}</td>
          
          <!-- 2° TURNO -->
          <td class="px-2 py-3 border-r border-gray-200 dark:border-gray-800 text-center ${chec2 ? 'text-green-400 font-bold' : 'text-gray-400'}">${chec2 || '-'}</td>
          <td class="px-2 py-3 border-r border-gray-200 dark:border-gray-800 text-center ${rep2 ? 'text-green-600 font-bold' : 'text-gray-400'}">${rep2 || '-'}</td>
          <td class="px-2 py-3 border-r border-gray-200 dark:border-gray-800 text-center ${scr2 ? 'text-red-600 font-bold bg-red-50 dark:bg-red-950/30' : 'text-gray-400'}">${scr2 || '-'}</td>
          <td class="px-2 py-3 border-r border-gray-200 dark:border-gray-800 text-center text-[10px] text-gray-500">${who2}</td>
          
          <!-- 3° TURNO -->
          <td class="px-2 py-3 border-r border-gray-200 dark:border-gray-800 text-center ${chec3 ? 'text-orange-400 font-bold' : 'text-gray-400'}">${chec3 || '-'}</td>
          <td class="px-2 py-3 border-r border-gray-200 dark:border-gray-800 text-center ${rep3 ? 'text-orange-600 font-bold' : 'text-gray-400'}">${rep3 || '-'}</td>
          <td class="px-2 py-3 border-r border-gray-200 dark:border-gray-800 text-center ${scr3 ? 'text-red-600 font-bold bg-red-50 dark:bg-red-950/30' : 'text-gray-400'}">${scr3 || '-'}</td>
          <td class="px-2 py-3 border-r border-gray-200 dark:border-gray-800 text-center text-[10px] text-gray-500">${who3}</td>
          
          <!-- TOTAIS -->
          <td class="px-4 py-3 border-r border-gray-200 dark:border-gray-800 text-center font-bold">${scrapTotal}</td>
          <td class="px-4 py-3 border-r border-gray-200 dark:border-gray-800 text-center font-black ${saldo > 0 ? 'text-toyota-red' : ''}">${saldo}</td>
          <td class="px-4 py-3 text-center font-black ${saldoDef > 0 ? 'text-yellow-600' : ''}">${saldoDef}</td>
        `;
        
        fragment.appendChild(tr);
      }

      tbody.innerHTML = '';
      tbody.appendChild(fragment);
    },

    updateTablePagerUI: () => {
      const info = document.getElementById('tbl-page-info');
      if (info) info.textContent = `Página ${State.tablePager.page}/${State.tablePager.totalPages}`;

      const prev = document.getElementById('tbl-prev');
      const next = document.getElementById('tbl-next');

      if (prev) { 
        prev.disabled = State.tablePager.page <= 1; 
        prev.classList.toggle('btn-disabled', prev.disabled); 
      }
      if (next) { 
        next.disabled = State.tablePager.page >= State.tablePager.totalPages; 
        next.classList.toggle('btn-disabled', next.disabled); 
      }
    },

    updateCharts: (stats) => {
      const paretoCanvas = document.getElementById('chartPareto');
      const statusCanvas = document.getElementById('chartStatus');

      if (paretoCanvas) {
        const ctxPareto = paretoCanvas.getContext('2d');
        State.charts.pareto = Charts.createParetoChart(ctxPareto, stats, (defectKey) => {
          UI.openDefectScreen(defectKey);
        });
      }

      if (statusCanvas) {
        const ctxStatus = statusCanvas.getContext('2d');
        State.charts.status = Charts.createStatusChart(ctxStatus, stats);
      }
    },

    renderDefectScreen: (defectKey) => {
      const defect = Utils.normalizeDefect(defectKey);
      const countsByPN = {};
      let totalAll = 0;

      (State.lastFilteredData || []).forEach(row => {
        const tipo = Utils.normalizeDefect(row[COL.tipoDef]);
        if (tipo !== defect) return;

        const pn = Utils.txt(row[COL.part]);
        const qty = Utils.int(row[COL.saldoDef]);
        if (qty <= 0) return;

        countsByPN[pn] = (countsByPN[pn] || 0) + qty;
        totalAll += qty;
      });

      document.getElementById('defect-title').innerHTML = `DEFEITO: <span style="color: #EB0A1E">${defect}</span>`;
      document.getElementById('defect-total').innerHTML = `<span style="font-size: 14px">${totalAll.toLocaleString()}</span> (Saldo Defeito)`;

      const items = Object.keys(countsByPN).map(pn => ({ pn, v: countsByPN[pn] })).sort((a, b) => b.v - a.v);

      let display = items.slice(0, CONFIG.TOP_PNS);
      if (items.length > CONFIG.TOP_PNS) {
        const othersSum = items.slice(CONFIG.TOP_PNS).reduce((acc, x) => acc + x.v, 0);
        if (othersSum > 0) display.push({ pn: 'OUTROS', v: othersSum });
      }

      const labels = display.map(x => x.pn);
      const values = display.map(x => x.v);

      let running = 0;
      const cumPct = values.map(v => {
        running += v;
        return totalAll > 0 ? Math.round((running / totalAll) * 1000) / 10 : 0;
      });

      const canvas = document.getElementById('chartDefectByPN');
      if (canvas) {
        const ctx = canvas.getContext('2d');
        State.charts.defectByPN = Charts.createDefectByPNChart(ctx, defect, { labels, values, cumPct, totalAll });
      }
    },

    renderMissingCheckScreen: () => {
      if (!State.data.length) return;

      const byPN = {};
      let total = 0;

      for (const row of State.data) {
        const pn = Utils.txt(row[COL.part]);
        const saldo = Utils.int(row[COL.saldo]);
        if (!pn || pn === '-' || saldo <= 0) continue;

        total += saldo;

        if (!byPN[pn]) byPN[pn] = { pn, qty: 0, minTs: null, maxTs: null };
        byPN[pn].qty += saldo;

        const d = Utils.parseDateBR(row[COL.data]);
        if (d) {
          const ts = d.getTime();
          if (byPN[pn].minTs === null || ts < byPN[pn].minTs) byPN[pn].minTs = ts;
          if (byPN[pn].maxTs === null || ts > byPN[pn].maxTs) byPN[pn].maxTs = ts;
        }
      }

      document.getElementById('missingcheck-total').innerText = `${(total || 0).toLocaleString()} peças`;

      let items = Object.values(byPN);
      const sortMode = document.getElementById('missingcheck-sort')?.value || 'oldest';

      if (sortMode === 'oldest') items.sort((a, b) => (a.minTs ?? Infinity) - (b.minTs ?? Infinity));
      else items.sort((a, b) => (b.maxTs ?? -Infinity) - (a.maxTs ?? -Infinity));

      const TOP = 20;
      const top = items.slice(0, TOP);
      const rest = items.slice(TOP);

      const display = [...top];
      if (rest.length) {
        const sum = rest.reduce((acc, x) => acc + (x.qty || 0), 0);
        if (sum > 0) display.push({ pn: 'OUTROS', qty: sum, minTs: null, maxTs: null });
      }

      const labels = display.map(x => x.pn);
      const values = display.map(x => x.qty);

      const canvas = document.getElementById('chartMissingCheck');
      if (canvas) {
        const ctx = canvas.getContext('2d');
        State.charts.missingCheck = Charts.createMissingCheckChart(ctx, { labels, values, items: display });
      }
    }
  };

  return {
    UI,
    DataManager,
    State,
    Utils,
    selectPN: (filter) => UI.selectPN(filter),
    backToMenu: () => UI.backToMenu(),
    backToDashboardFromDefect: () => UI.backToDashboardFromDefect(),
    openMissingCheckScreen: () => UI.openMissingCheckScreen(),
    backToMenuFromMissingCheck: () => UI.backToMenuFromMissingCheck(),
    closeLoginModal: () => UI.closeLoginModal(),
    closeManualModal: () => UI.closeManualModal(),
    closeAreaModal: () => UI.closeAreaModal(),
    closeBackupModal: () => UI.closeBackupModal(),
    clearQuickFilters: () => UI.clearQuickFilters(),
    updateComparativeChart: () => UI.updateComparativeChart(),
    toggleAreaCard: () => UI.toggleAreaCard(),
    toggleComparativeCard: () => UI.toggleComparativeCard()
  };
})();

window.onload = function() { ToyotaQC.UI.init(); };

window.selectPN = (filter) => ToyotaQC.selectPN(filter);
window.backToMenu = () => ToyotaQC.backToMenu();
window.backToDashboardFromDefect = () => ToyotaQC.backToDashboardFromDefect();
window.openMissingCheckScreen = () => ToyotaQC.openMissingCheckScreen();
window.backToMenuFromMissingCheck = () => ToyotaQC.backToMenuFromMissingCheck();
window.closeLoginModal = () => ToyotaQC.closeLoginModal();
window.closeAreaModal = () => ToyotaQC.closeAreaModal();
window.closeBackupModal = () => ToyotaQC.closeBackupModal();
window.updateComparativeChart = () => ToyotaQC.updateComparativeChart();
window.toggleAreaCard = () => ToyotaQC.toggleAreaCard();
window.toggleComparativeCard = () => ToyotaQC.toggleComparativeCard();