# Chamada — presença, cronograma e notas

App web instalável (PWA) para fazer chamada pelo celular Android e organizar a turma.
Funciona offline; os dados ficam só no aparelho.

**Versão 0.1.0** — a numeração fica em 0.x até o app ter todas as funcionalidades
planejadas; aí vira 1.0.

## O que faz
- **Cria a turma** a partir da lista de inscritos exportada pelo sistema acadêmico da UFF
  (.xls/.xlsx), já indicando carga horária, dias da semana e período das aulas (gera o
  cronograma) e o plano de avaliação.
- **Atualiza a lista** com uma planilha mais nova: mostra quem entrou, quem saiu
  (fica "fora da lista", sem perder histórico) e quem teve dados alterados.
- **Importa chamadas antigas** (colunas com datas; `1`/`P` = presente, `A` = atraso,
  `J` = justificada, vazio = falta), inclusive planilhas com a lista original colada
  ao lado; também importa colunas de notas e uma aba `cronograma` (data + conteúdo).
- **Chamada** em lista (P / A / J / F por aluno, com o total de faltas de cada um) ou
  **um a um** (botões grandes, para chamada oral). Botões "Todos presentes" / "Todos
  ausentes". Observações por aluno/aula (ex.: atestado).
- **Cronograma**: gera as datas por dia da semana; marca avaliações e dias sem aula.
- **Plano de avaliação**: quantas avaliações entram na média, com data, peso e nota máxima;
  VR (substitui a nota da prova perdida) e VS (para média parcial entre 4 e 6) opcionais.
  MP = média ponderada; MF segue a regra da UFF.
- **Resumo**: faltas (F + 0,5 × A, configurável), frequência e situação. O total de aulas vem
  da carga horária (padrão 68 h em aulas de 2 h = 34 aulas); reprova quem passar de 25% de faltas.
- **Curso e ingresso** a partir da matrícula (d1 = forma de ingresso, d2d3 = ano,
  d4d5d6 = código do curso). Tabela de cursos editável no app.
- **Exporta .xlsx formatado** (Chamada, Lista de presença, Notas, Cronograma, Alunos,
  Observações, Configuração), com fórmulas que continuam funcionando no Excel.
- **Lista de presença para assinatura** (aba da planilha) em dia de prova; quem já passou
  do limite de faltas aparece com o nome riscado.
- Backup/restauração em JSON.

## Uso
Abra <https://brasil-luis.github.io/classroom/> no Chrome do Android → menu ⋮ →
**Instalar app** (ou "Adicionar à tela inicial").

## Desenvolvimento
HTML/CSS/JS puro, sem build. Bibliotecas via CDN (guardadas em cache pelo service worker):
[xlsx-js-style](https://github.com/gitbrent/xlsx-js-style) 1.2.0 (SheetJS 0.18.5 com estilos).

```
python -m http.server 8765
```
e abra `http://localhost:8765/`.

- `js/core.js` — lógica (leitura de planilhas, mesclagem, estatísticas, exportação)
- `js/app.js` — interface
- `js/cursos-uff.js` — códigos de curso da UFF (tabela de 2006)
- `sw.js`, `manifest.webmanifest`, `icons/` — PWA (`tools/make_icons.py` gera os ícones)

Ao publicar uma versão nova, atualize `VERSAO` em `js/app.js` e `CACHE` em `sw.js`.
