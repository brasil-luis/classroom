# Chamada — presença, cronograma e notas

App web instalável (PWA) para fazer chamada pelo celular Android e organizar a turma.
Funciona offline; os dados ficam só no aparelho.

**Versão 0.3.0** — a numeração fica em 0.x até o app ter todas as funcionalidades
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
- **Leitura de folha de presença por foto** (📷 Ler folha, na chamada), 100% no aparelho
  com [Tesseract.js](https://github.com/naptha/tesseract.js): na *Lista de presença* impressa
  pelo app, presente = linha assinada; em folha em branco escrita à mão, cada linha é
  comparada com os alunos da turma (nome e/ou matrícula, tolerando erros de leitura).
  Sempre passa por uma tela de conferência antes de gravar.
- **Várias chamadas no mesmo dia** (aula dupla, reposição); cada chamada conta como uma aula.
- **Cronograma**: gera as datas por dia da semana; marca avaliações e dias sem aula.
- **Plano de avaliação**: quantas avaliações entram na média, com data, peso e nota máxima;
  VR (substitui a nota da prova perdida) e VS (para média parcial entre 4 e 6) opcionais.
  MP = média ponderada; MF segue a regra da UFF.
- **Filtrar e ordenar** alunos (aprovados, em VS, reprovados, por falta, perto do limite, por
  curso; ordem por nome, matrícula, faltas, média, curso) no Resumo, em Alunos e em Notas.
- **Estatísticas de notas** por avaliação e das médias (média, mediana, desvio, mín–máx,
  % acima da média, distribuição), no app e numa aba da planilha exportada.
- **E-mail aos alunos** pelo app de e-mail do aparelho: avisos (ex.: mudança de sala) para a
  turma em cópia oculta, ou mensagens personalizadas por aluno com modelos e campos como
  {primeiro_nome}, {faltas}, {notas}, {situacao}; modelos e assinatura salvos.
- **Pasta de trabalho** (geral ou por turma) para exportar e importar direto nela, onde o
  navegador permite (Chrome/Edge no computador; no Android depende da versão). Pergunta antes
  de sobrescrever. Sem suporte: "Salvar como…", Compartilhar ou Baixar.
- **Arquivar turmas** ao fim do período.
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
[xlsx-js-style](https://github.com/gitbrent/xlsx-js-style) 1.2.0 (SheetJS 0.18.5 com estilos) e,
sob demanda, tesseract.js 5.1.1 com o modelo `por` (baixados na primeira leitura de folha).

```
python -m http.server 8765
```
e abra `http://localhost:8765/`.

- `js/core.js` — lógica (leitura de planilhas, mesclagem, estatísticas, exportação)
- `js/app.js` — interface
- `js/ocr.js` — leitura de folhas por foto (preparo da imagem, OCR, detecção de assinatura)
- `js/pasta.js` — pasta de trabalho (File System Access API)
- `js/cursos-uff.js` — códigos de curso da UFF (tabela de 2006)
- `sw.js`, `manifest.webmanifest`, `icons/` — PWA (`tools/make_icons.py` gera os ícones)

Ao publicar uma versão nova, atualize `VERSAO` em `js/app.js` e `CACHE` em `sw.js`.
