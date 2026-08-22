# Preload benchmark (simulado)

Concorrência: 1

| Página | Sem preload (cold sim) | Preload fila (sim) | Abertura pós-cache | Ganho % |
|--------|------------------------|--------------------|--------------------|---------|
| executive_summary | 8500 ms | 604 ms (fila total) | 1 ms | 100% |
| general | 120 ms | 604 ms (fila total) | 0 ms | 100% |
| meetings | 7400 ms | 604 ms (fila total) | 0 ms | 100% |
| mechanisms | 2100 ms | 604 ms (fila total) | 0 ms | 100% |
| cancellations | 900 ms | 604 ms (fila total) | 0 ms | 100% |
| satisfaction | 400 ms | 604 ms (fila total) | 0 ms | 100% |

> Medição local simula latência cold do baseline e leitura warm do page cache frontend.
> Preload real também aquece cache server-side (Redis/memory) quando API responde.
