# Chamada — presença, cronograma e notas

App web instalável (PWA) para fazer chamada pelo celular Android e organizar a turma.
Funciona offline; os dados ficam só no aparelho.

**Versão 0.8.0** — a numeração fica em 0.x até o app ter todas as funcionalidades
planejadas; aí vira 1.0.

## O que faz
- **Projetos, disciplinas e turmas.** Um projeto é uma instituição (e, se quiser, um departamento):
  guarda as regras das turmas (frequência mínima, peso do atraso, médias) e o calendário letivo. Cada
  disciplina (código, nome, sigla, nível graduação/pós/outro, se aceita avulsos) guarda a carga horária
  e os tipos de aula; as turmas novas herdam tudo e a última turma da disciplina sugere o plano de
  avaliação e os dias de aula. Quem já usava o app tem os projetos e as disciplinas montados a partir
  das turmas que já existem.
- **Importar a pasta de um projeto** (ex.: `LK-UFF-aulas`): lê todas as planilhas da pasta e das
  subpastas; cada subpasta no padrão `UFF-código-sigla` vira uma disciplina e cada planilha uma turma
  (as de períodos passados ficam arquivadas; turmas que já existem não são duplicadas). A pasta pode
  ficar como pasta do projeto: a planilha exportada de uma turma é salva na pasta da disciplina, com o
  nome no mesmo padrão (`UFF-TCC00305-LFTC-2026b.xlsx`).
- **Calendário letivo** de cada período do projeto (início, fim, dias sem aula e avisos): lido do PDF do
  calendário escolar da universidade ([pdf.js](https://mozilla.github.io/pdf.js/), sob demanda), digitado
  (`07/09 Independência`, `13/10 a 17/10 Semana acadêmica`, `* 15/12 prazo das notas` para aviso),
  deduzido dos cronogramas das turmas ou completado com a previsão dos feriados (nacionais, do RJ, de Niterói e
  o Dia do Professor, feriado escolar na UFF). A lista oficial da UFF sai numa resolução própria no começo do
  ano (<https://www.uff.br/sobre/calendarios/>); o PDF dela também é lido: os feriados e pontos facultativos vão
  para os períodos em que caem, e dos municipais só os de Niterói.
  Ao gerar o cronograma de uma turma, os feriados entram como "Sem aula"; também dá para marcar de uma
  vez as aulas que já estavam no cronograma.
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
- **Exporta .xlsx formatado** (Chamada, Notas, Estatísticas, Cronograma, Alunos,
  Observações, Configuração e, se quiser, Lista de presença), com fórmulas que continuam
  funcionando no Excel.
- **Lista de presença para assinatura** em dia de prova, em **PDF** (A4, pronta para imprimir;
  [jsPDF](https://github.com/parallax/jsPDF)) ou como aba da planilha; quem já passou do
  limite de faltas aparece com o nome riscado. Dá para escolher quem entra: inscritos, só quem
  tem frequência, alunos para a VS (média parcial entre 4 e 6) ou para a VR (sem nota numa prova
  já feita), também os que saíram, uma faixa de média ou escolhidos à mão.
- **Tipos de aula** (ex.: Teórica, Laboratório) definidos por dia da semana, com troca à mão
  em qualquer aula; aparecem na chamada, no cronograma e na planilha, e a tela do aluno mostra
  as faltas por tipo.
- **Instituição** da turma: na UFF o curso e o ingresso saem da matrícula; em outras, a
  matrícula pode ter qualquer formato e a lista em PDF sai sem a coluna Curso.
- **Graduação e pós na mesma turma.** Vínculo do aluno pela matrícula: 9 dígitos = graduação;
  `M048.126.009` = Mestrado (D = Doutorado, A = avulso da pós). No começo do curso a pós aparece
  com o CPF como matrícula provisória; ao atualizar a lista, o aluno é reconhecido (CPF, e-mail ou
  nome) e passa para a matrícula definitiva. A pós não tem VS e pode ter outra média mínima.
  Uma lista só da pós (ex.: a pauta do sistema da pós) não tira da turma os alunos da graduação.
- A aba **Configuração** da planilha guarda a configuração da turma e é lida de volta ao
  importar a planilha numa turma nova.
- **Alunos de todas as turmas** (menu ⋮): cada pessoa identificada pelo **CPF** (sem CPF: matrícula, e-mail
  ou nome completo), com as turmas em que esteve; na tela do aluno, o quadro "Em outras turmas" mostra o
  histórico (situação e MF).
- **Importar várias planilhas de uma vez** (turmas antigas): uma turma para cada, arquivando as de períodos
  passados. Planilhas exportadas pelo app voltam completas: configuração, situação (inscrito / fora da
  lista), CPF e e-mail (aba Alunos), plano de avaliação e notas (aba Notas).
- **Várias listas oficiais de uma vez** (Atualizar lista): aplicadas em ordem de data (a do nome do arquivo,
  ex. `…-2024jul08.xls`, ou a da última modificação); fica registrado quando cada aluno entrou e saiu.
- **Importação assistida**: se o cabeçalho não for reconhecido, você escolhe a aba, a linha dos títulos e as
  colunas de matrícula, nome, e-mail e CPF, com prévia e contagem ao vivo.
- **Planilha que junta turmas**: ao importar numa turma com lista oficial, os alunos de outras turmas podem
  ficar de fora (só entram marcações e notas de quem é da turma).
- **Tema** da turma, para códigos genéricos ("Tópicos especiais em …").
- Dados no **IndexedDB** (cabem dezenas de turmas), com cópia no localStorage enquanto couber.
- Backup/restauração em JSON (cópia exata de tudo, para trocar de aparelho ou navegador).
- Nomes de arquivo legíveis: `LFTC 2026-2 - planilha.xlsx`, `LFTC 2026-2 - lista de presença P1.pdf`,
  `LFTC 2026-2 - backup 2026-10-12.json` (o nome curto vem da sigla da disciplina + período e
  pode ser trocado nas configurações da turma).

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
- `js/projetos.js` — projetos, disciplinas e calendário letivo (feriados, leitura do PDF do calendário)
- `js/app.js` — interface
- `js/ocr.js` — leitura de folhas por foto (preparo da imagem, OCR, detecção de assinatura)
- `js/pasta.js` — pasta de trabalho (File System Access API)
- `js/cursos-uff.js` — códigos de curso da UFF (tabela de 2006)
- `sw.js`, `manifest.webmanifest`, `icons/` — PWA (`tools/make_icons.py` gera os ícones)

Ao publicar uma versão nova, rode `python tools/nova_versao.py X.Y.Z` (troca a versão em
`js/app.js`, `sw.js` e nos endereços do `index.html`). O app instalado procura a versão nova ao
abrir e ao voltar para a tela, recarrega sozinho e avisa "App atualizado para a versão X.Y.Z".
