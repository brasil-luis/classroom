/* ClassroomControl — lógica pura (sem DOM).
 * Leitura de planilhas (lista da UFF, chamadas antigas, cronograma),
 * mesclagem de listas, estatísticas e montagem da planilha exportada. */
(function (g) {
  'use strict';

  const STATUS = ['P', 'A', 'J', 'F'];
  const STATUS_LABEL = { P: 'Presente', A: 'Atraso', J: 'Falta justificada', F: 'Falta' };
  const TIPOS = { aula: 'Aula', avaliacao: 'Avaliação', 'sem-aula': 'Sem aula' };
  const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  // Carga horária: disciplinas de 60, 64 ou 68 h com aulas de 2 h; por segurança, 68 h (34 aulas).
  // mediaVS: com média parcial entre mediaVS e mediaMin o aluno faz VS (padrão UFF: 4 a 6).
  // dias / inicio / fim: dias da semana das aulas (0 = dom) e período, para gerar o cronograma.
  const DEFAULT_CONFIG = { pesoAtraso: 0.5, freqMin: 75, mediaMin: 6, mediaVS: 4, cargaHoraria: 68, horasAula: 2, dias: [], inicio: '', fim: '' };
  const TIPOS_AVALIACAO = { normal: 'Entra na média', VR: 'VR — reposição', VS: 'VS — suplementar' };

  function uid(prefix) {
    return (prefix || '') + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function norm(s) {
    return String(s == null ? '' : s)
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/\s+/g, ' ').trim().toUpperCase();
  }

  function titleCase(s) {
    const lower = ['DA', 'DE', 'DO', 'DAS', 'DOS', 'E'];
    return String(s).trim().split(/\s+/).map((w, i) => {
      const u = w.toUpperCase();
      if (i > 0 && lower.includes(u)) return w.toLowerCase();
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    }).join(' ');
  }

  /* ---------- datas ---------- */

  function todayISO() {
    const d = new Date();
    return isoFromParts(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }

  function isoFromParts(y, m, d) {
    return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  }

  function serialToISO(n, date1904) {
    const ms = Math.round((n + (date1904 ? 1462 : 0) - 25569) * 86400000);
    return new Date(ms).toISOString().slice(0, 10);
  }

  function isoToSerial(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return Date.UTC(y, m - 1, d) / 86400000 + 25569;
  }

  function weekday(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  }

  function addDays(iso, n) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
  }

  function fmtDate(iso, withDay) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    const s = d + '/' + m;
    return withDay ? DIAS[weekday(iso)] + ' ' + s : s + '/' + y;
  }

  /** Interpreta um valor de célula como data; devolve 'AAAA-MM-DD' ou null. */
  function cellToISO(v, date1904, anoPadrao) {
    if (v == null || v === '') return null;
    if (v instanceof Date) return isoFromParts(v.getFullYear(), v.getMonth() + 1, v.getDate());
    if (typeof v === 'number') {
      return v > 30000 && v < 70000 ? serialToISO(v, date1904) : null;
    }
    const s = String(v).trim();
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return isoFromParts(+m[1], +m[2], +m[3]);
    m = s.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
    if (m) {
      let y = m[3] ? +m[3] : anoPadrao;
      if (!y) return null;
      if (y < 100) y += 2000;
      const d = +m[1], mo = +m[2];
      if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
      return isoFromParts(y, mo, d);
    }
    return null;
  }

  /* ---------- leitura de planilhas ---------- */

  /** Converte a aba em matriz [linha][coluna] começando em A1. */
  function sheetMatrix(XLSX, ws) {
    if (!ws || !ws['!ref']) return [];
    const range = XLSX.utils.decode_range(ws['!ref']);
    const rows = [];
    for (let r = 0; r <= range.e.r; r++) {
      const row = [];
      for (let c = 0; c <= range.e.c; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        row.push(cell ? cell.v : null);
      }
      rows.push(row);
    }
    return rows;
  }

  function isBlank(v) {
    return v == null || (typeof v === 'string' && v.trim() === '');
  }

  function findHeader(matrix) {
    for (let r = 0; r < Math.min(matrix.length, 40); r++) {
      const row = matrix[r];
      let mat = -1, nome = -1, cpf = -1, email = -1;
      row.forEach((v, c) => {
        if (typeof v !== 'string') return;
        const n = norm(v);
        if (mat < 0 && n.startsWith('MATR')) mat = c;
        else if (cpf < 0 && n === 'CPF') cpf = c;
        else if (nome < 0 && (n.includes('NOME') || n === 'ALUNO')) nome = c;
        else if (email < 0 && n.includes('MAIL')) email = c;
      });
      if (nome >= 0 && (mat >= 0 || email >= 0)) return { row: r, mat, nome, cpf, email };
    }
    return null;
  }

  function readMeta(matrix, upTo) {
    const meta = { disciplina: '', codigo: '', turma: '', periodo: '' };
    const keys = { DISCIPLINA: 'disciplina', CODIGO: 'codigo', TURMA: 'turma', PERIODO: 'periodo' };
    for (let r = 0; r < upTo; r++) {
      const row = matrix[r] || [];
      for (let c = 0; c < row.length; c++) {
        const key = keys[norm(row[c])];
        if (!key) continue;
        for (let k = c + 1; k < row.length; k++) {
          if (!isBlank(row[k])) { meta[key] = String(row[k]).trim(); break; }
        }
      }
    }
    return meta;
  }

  /** Matrícula UFF: 9 dígitos (às vezes gravada como número, sem o zero inicial). */
  function asMatricula(v) {
    if (typeof v === 'number' && Number.isInteger(v) && v >= 1e7 && v < 1e9) {
      return String(v).padStart(9, '0');
    }
    if (typeof v === 'string' && /^\d{8,9}$/.test(v.trim())) return v.trim().padStart(9, '0');
    return null;
  }

  function looksLikeName(v) {
    return typeof v === 'string' && !v.includes('@') && /[A-Za-zÀ-ÿ]{2,}\s+[A-Za-zÀ-ÿ]/.test(v);
  }

  function presenceValue(v) {
    if (isBlank(v)) return 'F';
    if (typeof v === 'number') return v > 0 ? 'P' : 'F';
    const s = norm(v);
    if (['P', 'X', '1', 'OK', 'C', '.'].includes(s)) return 'P';
    if (s.startsWith('A')) return 'A';
    if (s.startsWith('J')) return 'J';
    if (s.startsWith('F') || s === '0' || s === '-') return 'F';
    return 'P';
  }

  function tipoFromConteudo(t) {
    const s = norm(t);
    if (/^(FERIADO|SEM AULA|SEM ATIVIDADE|RECESSO|NAO HA AULA|SUSPENS)/.test(s)) return 'sem-aula';
    if (/^(VE\d*|VR|VS|P\d+|PROVA|AVALIA\w*|TESTE|EXAME)(\b|$)/.test(s)) return 'avaliacao';
    return 'aula';
  }

  /**
   * Analisa um arquivo de planilha. Reconhece:
   *  - a lista de inscritos exportada pelo sistema (cabeçalho Matrícula/CPF/Nome/E-mail);
   *  - chamadas antigas (colunas com datas no cabeçalho, inclusive com a lista
   *    original colada à direita — a matrícula mais à direita na linha é a que vale);
   *  - colunas de notas (cabeçalho de texto com valores numéricos);
   *  - uma aba "cronograma" (data + conteúdo).
   */
  function parseWorkbook(XLSX, wb) {
    const date1904 = !!(wb.Workbook && wb.Workbook.WBProps && wb.Workbook.WBProps.date1904);
    const result = {
      meta: { disciplina: '', codigo: '', turma: '', periodo: '' },
      alunos: [], datas: [], notas: [], cronograma: [], sheetName: null, avisos: []
    };

    let main = null;
    for (const name of wb.SheetNames) {
      const matrix = sheetMatrix(XLSX, wb.Sheets[name]);
      const header = findHeader(matrix);
      if (header) { main = { name, matrix, header }; break; }
    }

    for (const name of wb.SheetNames) {
      if (norm(name).includes('CRONO')) {
        result.cronograma = parseCronograma(sheetMatrix(XLSX, wb.Sheets[name]), date1904);
      }
    }

    if (!main) {
      result.avisos.push('Não encontrei uma linha de cabeçalho com "Matrícula" e "Nome".');
      return result;
    }

    const { matrix, header } = main;
    result.sheetName = main.name;
    result.meta = readMeta(matrix, header.row);
    const anoPadrao = parseInt(String(result.meta.periodo).slice(0, 4), 10) || new Date().getFullYear();
    const hrow = matrix[header.row];
    const idCols = [header.mat, header.nome, header.cpf, header.email];

    const dateCols = [];
    const textCols = [];
    hrow.forEach((v, c) => {
      if (idCols.includes(c)) return;
      const iso = cellToISO(v, date1904, anoPadrao);
      if (iso) dateCols.push({ c, iso });
      else if (typeof v === 'string' && v.trim()) textCols.push({ c, nome: v.trim() });
    });
    // Datas: só as do bloco principal (até a primeira coluna vazia de cabeçalho depois das datas).
    result.datas = dateCols.map(d => d.iso);

    const dataRows = [];
    for (let r = header.row + 1; r < matrix.length; r++) {
      const row = matrix[r];
      if (row.every(isBlank)) continue;

      let k = -1;
      row.forEach((v, c) => {
        if (c === header.cpf || dateCols.some(d => d.c === c)) return;
        if (asMatricula(v)) k = c;
      });

      const aluno = { matricula: '', cpf: '', nome: '', email: '', presencas: [], notas: {} };
      if (k >= 0) {
        aluno.matricula = asMatricula(row[k]);
        const fromHeader = k === header.mat;
        aluno.fonte = fromHeader ? 'cabecalho' : 'direita';
        for (let c = k + 1; c <= k + 4 && c < row.length; c++) {
          const v = row[c];
          if (!aluno.nome && looksLikeName(v)) aluno.nome = v.trim();
          else if (!aluno.email && typeof v === 'string' && v.includes('@')) aluno.email = v.trim();
          else if (!aluno.cpf && /^\d{10,11}$/.test(String(v || '').trim())) aluno.cpf = String(v).trim().padStart(11, '0');
        }
        if (!aluno.nome && looksLikeName(row[header.nome])) aluno.nome = row[header.nome].trim();
        if (fromHeader) {
          if (!aluno.email && header.email >= 0 && !isBlank(row[header.email])) aluno.email = String(row[header.email]).trim();
          if (!aluno.cpf && header.cpf >= 0 && !isBlank(row[header.cpf])) aluno.cpf = String(row[header.cpf]).trim().padStart(11, '0');
        }
      } else if (looksLikeName(row[header.nome])) {
        aluno.nome = row[header.nome].trim();
        if (header.email >= 0 && typeof row[header.email] === 'string') aluno.email = row[header.email].trim();
      } else {
        continue;
      }
      if (!aluno.nome && !aluno.matricula) continue;

      aluno.presencas = dateCols.map(d => presenceValue(row[d.c]));
      textCols.forEach(t => {
        const v = row[t.c];
        if (typeof v === 'number') aluno.notas[t.c] = v;
      });
      dataRows.push(aluno);
    }

    // Planilha com a lista original colada à direita: no bloco da esquerda as colunas
    // Matrícula/CPF podem estar deslocadas em relação a Nome/E-mail. Ali a matrícula é
    // "suspeita" (só vale se o nome conferir) e é descartada se pertencer a outra linha.
    const temBlocoDireita = dataRows.some(a => a.fonte === 'direita');
    if (temBlocoDireita) {
      const daDireita = new Set(dataRows.filter(a => a.fonte === 'direita').map(a => a.matricula));
      dataRows.forEach(a => {
        if (a.fonte !== 'cabecalho') return;
        a.matSuspeita = true;
        if (daDireita.has(a.matricula)) { a.matricula = ''; a.cpf = ''; }
      });
    }
    dataRows.forEach(a => { delete a.fonte; });

    // Uma mesma matrícula repetida (linhas desalinhadas): fica a primeira ocorrência com nome.
    const seen = new Set();
    result.alunos = dataRows.filter(a => {
      const key = a.matricula || 'N:' + norm(a.nome);
      if (seen.has(key)) { result.avisos.push('Linha repetida ignorada: ' + (a.nome || a.matricula)); return false; }
      seen.add(key);
      return true;
    });

    const ignorar = /FALTA|FREQ|TOTAL|SITUA|^MF$|MEDIA|OBS/;
    result.notas = textCols
      .filter(t => result.alunos.some(a => typeof a.notas[t.c] === 'number'))
      .map(t => {
        const vals = result.alunos.map(a => a.notas[t.c]).filter(v => typeof v === 'number');
        const maxVal = Math.max.apply(null, vals);
        return {
          col: t.c, nome: t.nome,
          max: maxVal > 10 ? 100 : 10,
          sugerida: !ignorar.test(norm(t.nome))
        };
      });

    if (!result.alunos.length) result.avisos.push('Nenhum aluno encontrado abaixo do cabeçalho.');
    return result;
  }

  function parseCronograma(matrix, date1904) {
    const out = [];
    matrix.forEach(row => {
      let iso = null, idx = -1;
      for (let c = 0; c < row.length; c++) {
        iso = cellToISO(row[c], date1904);
        if (iso) { idx = c; break; }
      }
      if (!iso) return;
      // Ignora colunas com o dia da semana ("seg", "Quarta-feira"...).
      const diaSemana = /^(dom|seg|ter|qua|qui|sex|s[aá]b)[a-zçá-]*\.?$/i;
      const textos = row.slice(idx + 1).filter(v => typeof v === 'string' && v.trim() && !diaSemana.test(v.trim())).map(v => v.trim());
      const conteudo = textos.join(' — ');
      out.push({ data: iso, conteudo, tipo: tipoFromConteudo(conteudo) });
    });
    return out;
  }

  /* ---------- modelo ---------- */

  function novaTurma(meta) {
    return {
      id: uid('t'),
      disciplina: meta.disciplina || 'Nova turma',
      codigo: meta.codigo || '',
      turma: meta.turma || '',
      periodo: meta.periodo || '',
      criadaEm: todayISO(),
      listaEm: null,
      config: Object.assign({}, DEFAULT_CONFIG),
      alunos: [],
      aulas: [],
      presencas: {},
      obs: {},
      avaliacoes: [],
      notas: {}
    };
  }

  function nomeTurma(t) {
    const partes = [t.codigo, t.turma].filter(Boolean).join(' ');
    return partes ? partes + ' — ' + t.disciplina : t.disciplina;
  }

  function sortAlunos(list) {
    return list.slice().sort((a, b) => norm(a.nome).localeCompare(norm(b.nome)));
  }

  function alunosOrdenados(t, incluirInativos) {
    const ativos = sortAlunos(t.alunos.filter(a => a.ativo));
    if (!incluirInativos) return ativos;
    return ativos.concat(sortAlunos(t.alunos.filter(a => !a.ativo)));
  }

  function aulasOrdenadas(t) {
    return t.aulas.slice().sort((a, b) => a.data.localeCompare(b.data) || (a.ordem || 0) - (b.ordem || 0));
  }

  /** Mesmo primeiro e último nome (tolera nomes do meio omitidos ou abreviados). */
  function nomesCompativeis(x, y) {
    const a = norm(x).split(' '), b = norm(y).split(' ');
    if (!a[0] || !b[0]) return false;
    return a[0] === b[0] && a[a.length - 1] === b[b.length - 1];
  }

  /**
   * Localiza o aluno da turma correspondente a um registro importado.
   * conferirNome: a matrícula só vale se o nome for compatível (planilhas antigas,
   * em que colunas podem ter sido deslocadas).
   */
  function findAluno(t, dado, conferirNome) {
    const porNome = () => {
      const n = norm(dado.nome);
      if (!n) return null;
      return t.alunos.find(a => norm(a.nome) === n) ||
        t.alunos.find(a => nomesCompativeis(a.nome, dado.nome) && (!a.matricula || !dado.matricula || conferirNome)) || null;
    };
    if (dado.matricula) {
      const m = t.alunos.find(a => a.matricula === dado.matricula);
      if (m && (!conferirNome || !dado.nome || nomesCompativeis(m.nome, dado.nome))) return m;
      if (m && conferirNome) return porNome();
    }
    return porNome();
  }

  /**
   * Compara a turma com uma lista oficial nova. Não altera nada; devolve o plano.
   * A lista é a referência de quem está inscrito: quem não aparece fica "fora da lista"
   * (com todo o histórico preservado).
   */
  function diffLista(t, parsed) {
    const plano = { novos: [], voltaram: [], saem: [], alterados: [], mantidos: 0 };
    const vistos = new Set();
    parsed.alunos.forEach(dado => {
      const a = findAluno(t, dado);
      if (!a) { plano.novos.push(dado); return; }
      vistos.add(a.id);
      if (!a.ativo) plano.voltaram.push(a);
      const mud = [];
      if (dado.nome && dado.nome !== a.nome && norm(dado.nome) !== norm(a.nome)) mud.push('nome');
      if (dado.email && dado.email !== a.email) mud.push('e-mail');
      if (dado.matricula && dado.matricula !== a.matricula) mud.push('matrícula');
      if (mud.length) plano.alterados.push({ aluno: a, dado, campos: mud });
      else plano.mantidos++;
    });
    t.alunos.forEach(a => {
      if (a.ativo && !vistos.has(a.id) && a.origem !== 'manual') plano.saem.push(a);
    });
    return plano;
  }

  function aplicarLista(t, parsed) {
    const hoje = todayISO();
    const plano = diffLista(t, parsed);
    parsed.alunos.forEach(dado => {
      let a = findAluno(t, dado);
      if (!a) {
        a = {
          id: uid('a'), matricula: dado.matricula, cpf: dado.cpf, nome: dado.nome,
          email: dado.email, origem: 'lista', ativo: true, entrouEm: hoje, saiuEm: null
        };
        t.alunos.push(a);
        return;
      }
      // Nome oficial vem em maiúsculas; se o professor já tinha um nome, a lista prevalece.
      if (dado.nome) a.nome = dado.nome;
      if (dado.email) a.email = dado.email;
      if (dado.cpf) a.cpf = dado.cpf;
      if (dado.matricula) a.matricula = dado.matricula;
      a.ativo = true;
      a.saiuEm = null;
      if (a.origem === 'manual') a.origem = 'lista';
    });
    plano.saem.forEach(a => { a.ativo = false; a.saiuEm = hoje; });
    t.listaEm = hoje;
    if (!t.codigo && parsed.meta.codigo) Object.assign(t, metaSemVazios(parsed.meta));
    return plano;
  }

  function metaSemVazios(meta) {
    const o = {};
    Object.keys(meta).forEach(k => { if (meta[k]) o[k] = meta[k]; });
    return o;
  }

  /** Acha (ou cria) a n-ésima aula de uma data. */
  function aulaDaData(t, iso, n, criar, conteudo) {
    const doDia = aulasOrdenadas(t).filter(a => a.data === iso);
    if (doDia[n || 0]) return doDia[n || 0];
    if (!criar) return null;
    const aula = { id: uid('d'), data: iso, conteudo: conteudo || '', tipo: tipoFromConteudo(conteudo || ''), ordem: doDia.length };
    t.aulas.push(aula);
    return aula;
  }

  /**
   * Importa chamada / notas / cronograma de uma planilha analisada.
   * Nunca sobrescreve uma marcação já feita no app: só preenche o que está vazio.
   */
  function importarDados(t, parsed, opcoes) {
    const o = Object.assign({ alunos: true, chamada: true, cronograma: true, notas: [] }, opcoes);
    const res = { alunosNovos: 0, marcacoes: 0, aulasNovas: 0, notas: 0 };
    const temLista = !!t.listaEm;

    if (o.cronograma && parsed.cronograma.length) {
      parsed.cronograma.forEach(item => {
        const antes = t.aulas.length;
        const aula = aulaDaData(t, item.data, 0, true, item.conteudo);
        if (t.aulas.length > antes) res.aulasNovas++;
        else if (!aula.conteudo && item.conteudo) {
          aula.conteudo = item.conteudo;
          // Uma aula que já tem chamada não vira "sem aula".
          if (!(item.tipo === 'sem-aula' && aulaRealizada(t, aula))) aula.tipo = item.tipo;
        }
      });
    }

    const contagem = {};
    const aulasCols = parsed.datas.map(iso => {
      contagem[iso] = (contagem[iso] || 0);
      const antes = t.aulas.length;
      const aula = o.chamada ? aulaDaData(t, iso, contagem[iso]++, true) : null;
      if (aula && t.aulas.length > antes) res.aulasNovas++;
      return aula;
    });

    const avMap = {};
    (o.notas || []).forEach(n => {
      let av = t.avaliacoes.find(a => norm(a.nome) === norm(n.nome));
      if (!av) {
        const tipo = /^(VR|VS)$/.test(norm(n.nome)) ? norm(n.nome) : 'normal';
        av = { id: uid('v'), nome: n.nome, tipo, data: '', peso: tipo === 'normal' ? 1 : 0, max: n.max };
        t.avaliacoes.push(av);
      }
      avMap[n.col] = av;
    });

    parsed.alunos.forEach(dado => {
      let a = findAluno(t, dado, true);
      if (!a) {
        if (!o.alunos) return;
        a = {
          id: uid('a'), matricula: dado.matSuspeita ? '' : dado.matricula, cpf: dado.matSuspeita ? '' : dado.cpf, nome: dado.nome,
          email: dado.email, origem: 'planilha', ativo: !temLista, entrouEm: todayISO(),
          saiuEm: temLista ? 'antes de ' + fmtDate(t.listaEm) : null
        };
        t.alunos.push(a);
        res.alunosNovos++;
      } else {
        if (!a.email && dado.email) a.email = dado.email;
        if (!dado.matSuspeita) {
          if (!a.cpf && dado.cpf) a.cpf = dado.cpf;
          if (!a.matricula && dado.matricula) a.matricula = dado.matricula;
        }
      }
      aulasCols.forEach((aula, i) => {
        if (!aula) return;
        const marc = t.presencas[aula.id] || (t.presencas[aula.id] = {});
        if (!marc[a.id]) { marc[a.id] = dado.presencas[i]; res.marcacoes++; }
      });
      Object.keys(avMap).forEach(col => {
        const v = dado.notas[col];
        if (typeof v !== 'number') return;
        const notas = t.notas[avMap[col].id] || (t.notas[avMap[col].id] = {});
        if (notas[a.id] == null) { notas[a.id] = v; res.notas++; }
      });
    });

    if (!t.codigo && parsed.meta.codigo) Object.assign(t, metaSemVazios(parsed.meta));
    sincronizarAvaliacoes(t);
    return res;
  }

  /** Gera aulas entre duas datas nos dias da semana escolhidos (0 = domingo). */
  function gerarCronograma(t, inicio, fim, dias) {
    let n = 0;
    for (let d = inicio; d <= fim; d = addDays(d, 1)) {
      if (!dias.includes(weekday(d))) continue;
      if (aulaDaData(t, d, 0, false)) continue;
      aulaDaData(t, d, 0, true);
      n++;
    }
    return n;
  }

  function removerAula(t, aulaId) {
    t.aulas = t.aulas.filter(a => a.id !== aulaId);
    delete t.presencas[aulaId];
    delete t.obs[aulaId];
  }

  function removerAluno(t, alunoId) {
    t.alunos = t.alunos.filter(a => a.id !== alunoId);
    Object.values(t.presencas).forEach(m => { delete m[alunoId]; });
    Object.values(t.obs).forEach(m => { delete m[alunoId]; });
    Object.values(t.notas).forEach(m => { delete m[alunoId]; });
  }

  /* ---------- estatísticas ---------- */

  function aulaRealizada(t, aula) {
    const m = t.presencas[aula.id];
    return aula.tipo !== 'sem-aula' && !!m && Object.keys(m).length > 0;
  }

  function contarAula(t, aula) {
    const c = { P: 0, A: 0, J: 0, F: 0, vazio: 0 };
    const m = t.presencas[aula.id] || {};
    t.alunos.filter(a => a.ativo).forEach(a => {
      const s = m[a.id];
      if (s) c[s]++; else c.vazio++;
    });
    return c;
  }

  /** Total de aulas do período: carga horária ÷ horas por aula (sem carga, conta o cronograma). */
  function aulasPrevistas(t) {
    const c = t.config;
    if (c.cargaHoraria > 0 && c.horasAula > 0) return Math.round(c.cargaHoraria / c.horasAula);
    return t.aulas.filter(a => a.tipo !== 'sem-aula').length;
  }

  /** Máximo de faltas permitido (pode ser fracionário: 25% de 34 = 8,5). Reprova quem passar disso. */
  function limiteFaltas(t) {
    return Math.round(aulasPrevistas(t) * (1 - t.config.freqMin / 100) * 100) / 100;
  }

  function reprovadoPorFalta(t, faltas) {
    return faltas > limiteFaltas(t) + 1e-9;
  }

  function statsAluno(t, aluno) {
    const s = { P: 0, A: 0, J: 0, F: 0, registradas: 0 };
    t.aulas.forEach(aula => {
      if (aula.tipo === 'sem-aula') return;
      const v = (t.presencas[aula.id] || {})[aluno.id];
      if (v) { s[v]++; s.registradas++; }
    });
    s.faltas = s.F + t.config.pesoAtraso * s.A;
    s.freq = s.registradas ? 1 - s.faltas / s.registradas : null;
    s.limite = limiteFaltas(t);
    s.media = mediaAluno(t, aluno);
    s.mf = mediaFinal(t, aluno, s.media);
    s.situacao = situacao(t, s);
    return s;
  }

  /* ---------- avaliações (plano padrão UFF: provas/trabalhos com peso, VR e VS) ---------- */

  /** Avaliações que entram na média, na ordem do plano. */
  function avaliacoesMedia(t) {
    return t.avaliacoes.filter(v => (!v.tipo || v.tipo === 'normal') && v.peso > 0 && v.max > 0);
  }

  function avaliacaoTipo(t, tipo) {
    return t.avaliacoes.find(v => v.tipo === tipo && v.max > 0) || null;
  }

  /** Nota na escala 0–10 (ou null se não lançada). */
  function notaDez(t, v, aluno) {
    const n = (t.notas[v.id] || {})[aluno.id];
    return typeof n === 'number' && v.max > 0 ? n / v.max * 10 : null;
  }

  const arred1 = x => Math.round(x * 10 + 1e-9) / 10;

  /** Média parcial (MP), com 1 casa: média ponderada; a VR substitui a primeira avaliação sem nota. */
  function mediaAluno(t, aluno) {
    const avs = avaliacoesMedia(t);
    if (!avs.length) return null;
    const vr = avaliacaoTipo(t, 'VR');
    let vrNota = vr ? notaDez(t, vr, aluno) : null;
    let soma = 0, pesos = 0, algum = false;
    avs.forEach(v => {
      let n = notaDez(t, v, aluno);
      if (n == null && vrNota != null) { n = vrNota; vrNota = null; }
      if (n != null) algum = true;
      soma += v.peso * (n || 0);
      pesos += v.peso;
    });
    return algum ? arred1(soma / pesos) : null;
  }

  /** Média final (MF): MP ≥ média mínima → MP; entre mediaVS e a mínima → nota da VS
   *  (null enquanto não houver); abaixo de mediaVS → MP. Sem VS no plano, MF = MP. */
  function mediaFinal(t, aluno, mp) {
    if (mp == null) return null;
    const vs = avaliacaoTipo(t, 'VS');
    if (!vs || mp >= t.config.mediaMin || mp < t.config.mediaVS) return mp;
    const n = notaDez(t, vs, aluno);
    return n == null ? null : arred1(n);
  }

  function situacao(t, s) {
    if (reprovadoPorFalta(t, s.faltas)) return { cod: 'RF', texto: 'Reprovado por falta' };
    if (s.limite > 0 && s.faltas >= s.limite - 1) return { cod: 'LIM', texto: 'Perto do limite de faltas' };
    if (s.media == null) return { cod: '', texto: '' };
    const min = t.config.mediaMin;
    if (s.media >= min) return { cod: 'OK', texto: 'Média suficiente' };
    if (avaliacaoTipo(t, 'VS') && s.media >= t.config.mediaVS) {
      if (s.mf == null) return { cod: 'VS', texto: 'Precisa de VS' };
      return s.mf >= min ? { cod: 'OK', texto: 'Aprovado na VS' } : { cod: 'BAIXA', texto: 'Reprovado na VS' };
    }
    return { cod: 'BAIXA', texto: 'Abaixo da média' };
  }

  /** Garante que cada avaliação com data tenha a aula correspondente marcada como avaliação;
   *  e dá data às avaliações sem data cujo nome aparece no cronograma (ex.: "P1"). */
  function sincronizarAvaliacoes(t) {
    t.avaliacoes.forEach(v => {
      if (!v.data) {
        const aula = aulasOrdenadas(t).find(a => a.tipo === 'avaliacao' && norm(a.conteudo) === norm(v.nome));
        if (aula) v.data = aula.data;
        return;
      }
      const aula = aulaDaData(t, v.data, 0, true, v.nome);
      if (aula.tipo !== 'sem-aula') aula.tipo = 'avaliacao';
      if (!aula.conteudo) aula.conteudo = v.nome;
    });
  }

  /** Aplica um plano [{ id?, nome, tipo, data, peso, max }]; avaliações fora do plano são
   *  removidas com suas notas. Devolve quantas notas foram descartadas. */
  function aplicarPlano(t, plano) {
    const manter = new Set();
    plano.forEach(item => {
      let v = item.id && t.avaliacoes.find(x => x.id === item.id);
      if (!v) { v = { id: uid('v') }; t.avaliacoes.push(v); }
      Object.assign(v, { nome: item.nome, tipo: item.tipo || 'normal', data: item.data || '', peso: item.peso, max: item.max });
      manter.add(v.id);
    });
    let descartadas = 0;
    t.avaliacoes.filter(v => !manter.has(v.id)).forEach(v => {
      descartadas += Object.keys(t.notas[v.id] || {}).length;
      delete t.notas[v.id];
    });
    // Mantém a ordem do plano (normais, depois VR e VS).
    const ordem = plano.map(item => item.id).filter(Boolean);
    t.avaliacoes = t.avaliacoes.filter(v => manter.has(v.id));
    const pos = v => { const k = ordem.indexOf(v.id); return k < 0 ? 999 : k; };
    const peso = v => v.tipo === 'VR' ? 1 : v.tipo === 'VS' ? 2 : 0;
    t.avaliacoes.sort((a, b) => peso(a) - peso(b) || pos(a) - pos(b));
    sincronizarAvaliacoes(t);
    return descartadas;
  }

  /** Plano padrão da UFF: n provas de peso 1, nota de 0 a 10, mais VR e VS. */
  function planoPadrao(n, comVR, comVS) {
    const p = [];
    for (let i = 1; i <= n; i++) p.push({ nome: 'P' + i, tipo: 'normal', data: '', peso: 1, max: 10 });
    if (comVR) p.push({ nome: 'VR', tipo: 'VR', data: '', peso: 0, max: 10 });
    if (comVS) p.push({ nome: 'VS', tipo: 'VS', data: '', peso: 0, max: 10 });
    return p;
  }

  /* ---------- matrícula UFF (9 dígitos) ----------
   * d1 = forma de ingresso, d2d3 = ano, d4d5d6 = código do curso (cCurso com zero à
   * esquerda: 2 23 031 134 → 031 = Ciência da Computação), d7–d9 = ordem. Sem dígito verificador. */

  const FORMAS_INGRESSO = {
    1: 'Processo seletivo, 1º sem.', 2: 'Processo seletivo, 2º sem.', 3: 'Transferência',
    4: 'Revinculação', 5: 'Disciplina isolada / mobilidade', 6: 'Mudança de curso',
    7: 'Convênio cultural', 8: 'Reingresso', 9: 'Mandado judicial', 0: 'Rematrícula'
  };

  function infoMatricula(mat, cursos) {
    if (!/^\d{9}$/.test(mat || '')) return null;
    const forma = +mat[0];
    const ano = 2000 + +mat.slice(1, 3);
    const cod = mat.slice(3, 6);
    const nomeCurso = (cursos || {})[cod];
    return {
      forma, ano, cod,
      semestre: forma === 1 ? 1 : forma === 2 ? 2 : null,
      formaTexto: FORMAS_INGRESSO[forma],
      curso: nomeCurso || 'curso ' + cod,
      cursoConhecido: !!nomeCurso,
      ingresso: ano + (forma === 1 ? '/1 · Processo seletivo' : forma === 2 ? '/2 · Processo seletivo' : ' · ' + FORMAS_INGRESSO[forma])
    };
  }

  /** Códigos de curso presentes nas turmas: { '03': 40, ... } */
  function cursosEncontrados(turmas) {
    const n = {};
    turmas.forEach(t => t.alunos.forEach(a => {
      const i = infoMatricula(a.matricula);
      if (i) n[i.cod] = (n[i.cod] || 0) + 1;
    }));
    return n;
  }

  /* ---------- exportação ---------- */

  function numBR(v, casas) {
    return v == null ? '' : v.toFixed(casas == null ? 1 : casas).replace('.', ',');
  }

  function sheetName(s) {
    return s.replace(/[:\\/?*[\]]/g, ' ').slice(0, 31);
  }

  // Paleta da planilha (a mesma do app).
  const COR = {
    primaria: '1F5F8B', texto: '1B2430', cinza: '5F6B7A', borda: 'C9D2DC', zebra: 'F4F6F8', claro: 'E8EEF4', inativo: '8A96A3',
    P: ['E3F3E4', '2E7D32'], A: ['FFF1D6', 'B26A00'], J: ['E1ECFA', '1565C0'], F: ['FBE3E3', 'C62828']
  };
  const FONTE = 'Calibri';
  const BORDA = { style: 'thin', color: { rgb: COR.borda } };
  const BORDAS = { top: BORDA, bottom: BORDA, left: BORDA, right: BORDA };

  /** Estilo de célula com borda; extra: { font, fill (rgb), alignment, numFmt }. */
  function estilo(extra) {
    const e = extra || {};
    const st = {
      font: Object.assign({ name: FONTE, sz: 11, color: { rgb: COR.texto } }, e.font),
      border: BORDAS,
      alignment: Object.assign({ vertical: 'center' }, e.alignment)
    };
    if (e.fill) st.fill = { patternType: 'solid', fgColor: { rgb: e.fill } };
    if (e.numFmt) st.numFmt = e.numFmt;
    return st;
  }

  const ST = {
    titulo: () => ({ font: { name: FONTE, sz: 15, bold: true, color: { rgb: COR.primaria } } }),
    subtitulo: () => ({ font: { name: FONTE, sz: 10, italic: true, color: { rgb: COR.cinza } } }),
    cab: (fill) => estilo({ font: { bold: true, color: { rgb: 'FFFFFF' } }, fill: fill || COR.primaria, alignment: { horizontal: 'center', wrapText: true } }),
    cabEsq: () => estilo({ font: { bold: true, color: { rgb: 'FFFFFF' } }, fill: COR.primaria, alignment: { horizontal: 'left' } }),
    rotulo: () => estilo({ font: { bold: true, color: { rgb: COR.cinza } }, fill: COR.claro, alignment: { horizontal: 'center' } })
  };

  /** Célula do corpo: listras alternadas; aluno fora da lista em cinza itálico. */
  function corpo(linha, inativo, extra) {
    const e = Object.assign({}, extra);
    if (!e.fill && linha % 2) e.fill = COR.zebra;
    if (inativo) e.font = Object.assign({ italic: true, color: { rgb: COR.inativo } }, e.font);
    return estilo(e);
  }

  function celStatus(v, texto) {
    const c = COR[v];
    return {
      t: 's', v: texto || v,
      s: estilo({ font: { bold: true, color: { rgb: c[1] } }, fill: c[0], alignment: { horizontal: 'center' } })
    };
  }

  /** Monta o workbook .xlsx formatado: Chamada, Lista de presença, Notas, Cronograma, Alunos, Observações, Configuração.
   *  opcoes.lista = { titulo, data, extras } para o cabeçalho da lista de presença. */
  function montarPlanilha(XLSX, t, cursos, opcoes) {
    const U = XLSX.utils;
    const wb = U.book_new();
    const alunos = alunosOrdenados(t, true);
    const aulas = aulasOrdenadas(t).filter(a => a.tipo !== 'sem-aula');
    const titulo = nomeTurma(t) + (t.periodo ? ' — ' + t.periodo : '');
    const peso = t.config.pesoAtraso;
    const pesoTxt = String(peso);
    const limite = limiteFaltas(t);
    const situacaoTxt = a => a.ativo ? 'inscrito' : 'fora da lista' + (a.saiuEm ? ' (' + (a.saiuEm.includes('-') ? fmtDate(a.saiuEm) : a.saiuEm) + ')' : '');
    const cursoDe = a => { const i = infoMatricula(a.matricula, cursos); return i ? i.curso : ''; };
    const put = (ws, r, c, cell) => { ws[U.encode_cell({ r, c })] = cell; };
    const s = (v, st) => ({ t: 's', v: String(v == null ? '' : v), s: st });
    const n = (v, st, extra) => Object.assign({ t: 'n', v, s: st }, extra);
    const centro = { alignment: { horizontal: 'center' } };
    const statsDe = {};
    alunos.forEach(a => { statsDe[a.id] = statsAluno(t, a); });

    // ---- Chamada
    const ch = {};
    put(ch, 0, 0, s(titulo, ST.titulo()));
    put(ch, 1, 0, s('P = presente · F = falta · A = atraso (vale ' + pesoTxt.replace('.', ',') + ' falta) · J = falta justificada (não conta) · ' +
      'reprova com mais de ' + numBR(limite, limite % 1 ? 1 : 0) + ' faltas (' + aulasPrevistas(t) + ' aulas) · datas em laranja = avaliação', ST.subtitulo()));
    const H = 3, C0 = 4;
    ['Matrícula', 'Nome', 'Curso', 'Situação'].forEach((h, c) => put(ch, H, c, s(h, c === 1 ? ST.cabEsq() : ST.cab())));
    aulas.forEach((aula, i) => {
      const st = ST.cab(aula.tipo === 'avaliacao' ? COR.A[1] : null);
      st.numFmt = 'dd/mm';
      put(ch, H, C0 + i, n(isoToSerial(aula.data), st, { z: 'dd/mm' }));
    });
    const cF = C0 + aulas.length, cFreq = cF + 1;
    put(ch, H, cF, s('Faltas', ST.cab()));
    put(ch, H, cFreq, s('Freq.', ST.cab()));
    alunos.forEach((a, i) => {
      const r = H + 1 + i, inativo = !a.ativo, st = statsDe[a.id];
      put(ch, r, 0, s(a.matricula, corpo(i, inativo, centro)));
      put(ch, r, 1, s(a.nome, corpo(i, inativo)));
      put(ch, r, 2, s(cursoDe(a), corpo(i, inativo, { font: { sz: 9 } })));
      put(ch, r, 3, s(situacaoTxt(a), corpo(i, inativo, { font: { sz: 9 } })));
      aulas.forEach((aula, j) => {
        const v = (t.presencas[aula.id] || {})[a.id];
        put(ch, r, C0 + j, v ? celStatus(v) : s('', corpo(i, inativo)));
      });
      if (aulas.length) {
        const rng = U.encode_cell({ r, c: C0 }) + ':' + U.encode_cell({ r, c: cF - 1 });
        const fCell = U.encode_cell({ r, c: cF });
        const rf = reprovadoPorFalta(t, st.faltas);
        put(ch, r, cF, n(st.faltas, corpo(i, inativo, {
          font: { bold: true, color: { rgb: rf ? COR.F[1] : COR.texto } }, fill: rf ? COR.F[0] : undefined,
          alignment: { horizontal: 'center' }, numFmt: '0.0'
        }), { f: 'COUNTIF(' + rng + ',"F")+' + pesoTxt + '*COUNTIF(' + rng + ',"A")', z: '0.0' }));
        // Células "vazias" levam formatação e são gravadas como texto "": por isso a
        // contagem das marcações é explícita (COUNTA contaria as vazias).
        const marcadas = ['P', 'A', 'J', 'F'].map(k => 'COUNTIF(' + rng + ',"' + k + '")').join('+');
        put(ch, r, cFreq, st.freq == null ? s('', corpo(i, inativo)) : n(st.freq, corpo(i, inativo, { alignment: { horizontal: 'center' }, numFmt: '0%' }), {
          z: '0%', f: 'IF((' + marcadas + ')=0,"",1-' + fCell + '/(' + marcadas + '))'
        }));
      }
    });
    // Totais por aula (presentes = P + A).
    const rTot = H + 1 + alunos.length;
    put(ch, rTot, 1, s('Presentes (P + A)', ST.rotulo()));
    aulas.forEach((aula, j) => {
      const col = U.encode_col(C0 + j);
      const rng = col + (H + 2) + ':' + col + rTot;
      const c = contarAula(t, aula);
      put(ch, rTot, C0 + j, aulaRealizada(t, aula)
        ? n(c.P + c.A, ST.rotulo(), { f: 'COUNTIF(' + rng + ',"P")+COUNTIF(' + rng + ',"A")' })
        : s('', ST.rotulo()));
    });
    ch['!ref'] = U.encode_range({ s: { r: 0, c: 0 }, e: { r: rTot, c: Math.max(cFreq, 3) } });
    ch['!cols'] = [{ wch: 11 }, { wch: 44 }, { wch: 22 }, { wch: 24 }]
      .concat(aulas.map(() => ({ wch: 6 }))).concat([{ wch: 7 }, { wch: 7 }]);
    ch['!rows'] = [{ hpt: 24 }, { hpt: 16 }, { hpt: 6 }, { hpt: 20 }];
    if (alunos.length) ch['!autofilter'] = { ref: U.encode_range({ s: { r: H, c: 0 }, e: { r: H + alunos.length, c: cFreq } }) };
    U.book_append_sheet(wb, ch, 'Chamada');

    // ---- Lista de presença (para assinatura em dia de prova)
    // Quem já passou do limite de faltas aparece com o nome riscado.
    const lp = {};
    const ol = Object.assign({ titulo: '', data: '', extras: 3 }, opcoes && opcoes.lista);
    const ativos = alunos.filter(a => a.ativo);
    const limTxt = numBR(limite, limite % 1 ? 1 : 0);
    const textoLivre = (v, extra) => s(v, Object.assign({ font: Object.assign({ name: FONTE, sz: 11, color: { rgb: COR.texto } }, extra && extra.font) }, extra && extra.alignment ? { alignment: extra.alignment } : {}));
    put(lp, 0, 0, s('Lista de presença' + (ol.titulo ? ' — ' + ol.titulo : ''), ST.titulo()));
    put(lp, 1, 0, textoLivre(t.disciplina, { font: { bold: true } }));
    put(lp, 2, 0, textoLivre([t.codigo && 'Código: ' + t.codigo, t.turma && 'Turma: ' + t.turma, t.periodo && 'Período: ' + t.periodo].filter(Boolean).join('     ·     ')));
    put(lp, 3, 0, textoLivre('Data: ' + (ol.data ? fmtDate(ol.data) : '____/____/________'), { font: { bold: true } }));
    put(lp, 3, 2, textoLivre('                         Professor(a): ______________________________'));
    const LH = 5;
    ['Nº', 'Matrícula', 'Nome', 'Curso', 'Assinatura'].forEach((h, c) => put(lp, LH, c, s(h, c === 2 ? ST.cabEsq() : ST.cab())));
    let riscados = 0;
    const linhasLista = ativos.length + Math.max(0, ol.extras | 0);
    for (let i = 0; i < linhasLista; i++) {
      const a = ativos[i];
      const r = LH + 1 + i;
      const risca = !!a && reprovadoPorFalta(t, statsDe[a.id].faltas);
      if (risca) riscados++;
      const fonte = risca ? { strike: true, color: { rgb: COR.inativo } } : {};
      put(lp, r, 0, n(i + 1, corpo(i, false, { font: { sz: 9, color: { rgb: COR.cinza } }, alignment: { horizontal: 'center' } })));
      put(lp, r, 1, s(a ? a.matricula : '', corpo(i, false, { font: Object.assign({ sz: 10 }, fonte), alignment: { horizontal: 'center' } })));
      put(lp, r, 2, s(a ? a.nome : '', corpo(i, false, { font: Object.assign({ sz: 10 }, fonte), alignment: { wrapText: true } })));
      put(lp, r, 3, s(a ? cursoDe(a) : '', corpo(i, false, { font: Object.assign({ sz: 7, color: { rgb: COR.cinza } }, fonte), alignment: { wrapText: true } })));
      put(lp, r, 4, s('', corpo(i, false)));
    }
    const rNota = LH + 2 + linhasLista;
    put(lp, rNota, 0, s(ativos.length + ' inscritos' +
      (riscados ? ' · riscados: mais de ' + limTxt + ' faltas (25% de ' + aulasPrevistas(t) + ' aulas) em ' + fmtDate(todayISO()) : ''),
      ST.subtitulo()));
    lp['!ref'] = U.encode_range({ s: { r: 0, c: 0 }, e: { r: rNota, c: 4 } });
    // Larguras que cabem numa folha A4 em pé (margens de 1 cm); ajustáveis no Excel.
    lp['!cols'] = [{ wch: 4 }, { wch: 10.5 }, { wch: 35 }, { wch: 12 }, { wch: 26 }];
    lp['!rows'] = [{ hpt: 24 }, { hpt: 17 }, { hpt: 17 }, { hpt: 20 }, { hpt: 8 }, { hpt: 20 }];
    for (let i = 0; i < linhasLista; i++) lp['!rows'][LH + 1 + i] = { hpt: 26 };
    lp['!margins'] = { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.25, footer: 0.25 };
    U.book_append_sheet(wb, lp, 'Lista de presença');
    // Repete o cabeçalho da tabela em cada página impressa.
    wb.Workbook = wb.Workbook || {};
    wb.Workbook.Names = (wb.Workbook.Names || []).concat([{
      Name: '_xlnm.Print_Titles', Sheet: wb.SheetNames.length - 1, Ref: "'Lista de presença'!$" + (LH + 1) + ':$' + (LH + 1)
    }]);

    // ---- Notas: MP = média ponderada (escala 0–10, 1 casa); VR substitui a 1ª avaliação sem nota;
    // com VS no plano e MP entre mediaVS e mediaMin, MF = VS.
    const ordemTipo = v => v.tipo === 'VR' ? 1 : v.tipo === 'VS' ? 2 : 0;
    const avs = t.avaliacoes.slice().sort((a, b) => ordemTipo(a) - ordemTipo(b));
    const vr = avaliacaoTipo(t, 'VR'), vs = avaliacaoTipo(t, 'VS');
    const minM = t.config.mediaMin, minVS = t.config.mediaVS;
    const nt = {};
    put(nt, 0, 0, s(titulo, ST.titulo()));
    put(nt, 1, 0, s('MP = média ponderada das notas (nota ÷ máximo × 10)' + (vr ? ' · VR substitui a 1ª avaliação sem nota' : '') +
      (vs ? ' · MP entre ' + numBR(minVS) + ' e ' + numBR(minM) + ' → MF = VS' : '') + ' · média mínima ' + numBR(minM) +
      ' · reprova com mais de ' + numBR(limite, limite % 1 ? 1 : 0) + ' faltas', ST.subtitulo()));
    const NH = 6, N0 = 3;
    const lPeso = 4, lMax = 5, lData = 6; // linhas (base 1) de peso, nota máxima e data
    put(nt, lPeso - 1, N0 - 1, s('Peso', ST.rotulo()));
    put(nt, lMax - 1, N0 - 1, s('Nota máxima', ST.rotulo()));
    put(nt, lData - 1, N0 - 1, s('Data', ST.rotulo()));
    ['Matrícula', 'Nome', 'Curso'].forEach((h, c) => put(nt, NH, c, s(h, c === 1 ? ST.cabEsq() : ST.cab())));
    const colDe = {};
    avs.forEach((v, i) => {
      const c = N0 + i;
      colDe[v.id] = U.encode_col(c);
      const normal = !v.tipo || v.tipo === 'normal';
      put(nt, lPeso - 1, c, normal ? n(v.peso, ST.rotulo()) : s('—', ST.rotulo()));
      put(nt, lMax - 1, c, n(v.max, ST.rotulo()));
      put(nt, lData - 1, c, v.data
        ? n(isoToSerial(v.data), Object.assign(ST.rotulo(), { numFmt: 'dd/mm' }), { z: 'dd/mm' })
        : s('', ST.rotulo()));
      put(nt, NH, c, s(v.nome, ST.cab(normal ? null : COR.J[1])));
    });
    const cMP = N0 + avs.length;
    const cMF = vs ? cMP + 1 : -1;
    const cFal = (vs ? cMF : cMP) + 1, cSit = cFal + 1;
    put(nt, NH, cMP, s(vs ? 'MP' : 'Média', ST.cab()));
    if (vs) put(nt, NH, cMF, s('MF', ST.cab()));
    put(nt, NH, cFal, s('Faltas', ST.cab()));
    put(nt, NH, cSit, s('Situação', ST.cab()));
    const usaveis = avaliacoesMedia(t);
    alunos.forEach((a, i) => {
      const r = NH + 1 + i, R = r + 1, inativo = !a.ativo, st = statsDe[a.id];
      put(nt, r, 0, s(a.matricula, corpo(i, inativo, centro)));
      put(nt, r, 1, s(a.nome, corpo(i, inativo)));
      put(nt, r, 2, s(cursoDe(a), corpo(i, inativo, { font: { sz: 9 } })));
      avs.forEach((v, j) => {
        const nota = (t.notas[v.id] || {})[a.id];
        put(nt, r, N0 + j, typeof nota === 'number'
          ? n(nota, corpo(i, inativo, { alignment: { horizontal: 'center' }, numFmt: '0.0#' }), { z: '0.0#' })
          : s('', corpo(i, inativo)));
      });
      const fMP = U.encode_cell({ r, c: cMP });
      const fMF = vs ? U.encode_cell({ r, c: cMF }) : fMP;
      if (usaveis.length) {
        const VR = vr && colDe[vr.id];
        const termos = usaveis.map((v, j) => {
          const X = colDe[v.id];
          if (!VR) return X + '$' + lPeso + '*N(' + X + R + ')/' + X + '$' + lMax + '*10';
          const antes = usaveis.slice(0, j).map(w => colDe[w.id] + R);
          const cond = antes.length ? 'COUNT(' + antes.join(',') + ')=' + antes.length : 'TRUE';
          return X + '$' + lPeso + '*IF(ISNUMBER(' + X + R + '),' + X + R + '/' + X + '$' + lMax + '*10,IF(AND(' + cond +
            ',ISNUMBER(' + VR + R + ')),' + VR + R + '/' + VR + '$' + lMax + '*10,0))';
        }).join('+');
        const pesos = usaveis.map(v => colDe[v.id] + '$' + lPeso).join('+');
        const todas = usaveis.map(v => colDe[v.id] + R).concat(VR ? [VR + R] : []).join(',');
        put(nt, r, cMP, st.media == null
          ? s('', corpo(i, inativo, { font: { bold: true }, alignment: { horizontal: 'center' } }))
          : n(st.media, corpo(i, inativo, { font: { bold: true }, alignment: { horizontal: 'center' }, numFmt: '0.0' }), { z: '0.0' }));
        nt[fMP].f = 'IF(COUNT(' + todas + ')=0,"",ROUND((' + termos + ')/(' + pesos + '),1))';
        if (vs) {
          const VS = colDe[vs.id];
          put(nt, r, cMF, st.mf == null
            ? s('', corpo(i, inativo, { font: { bold: true }, alignment: { horizontal: 'center' } }))
            : n(st.mf, corpo(i, inativo, { font: { bold: true }, alignment: { horizontal: 'center' }, numFmt: '0.0' }), { z: '0.0' }));
          nt[fMF].f = 'IF(' + fMP + '="","",IF(OR(' + fMP + '>=' + minM + ',' + fMP + '<' + minVS + '),' + fMP +
            ',IF(ISNUMBER(' + VS + R + '),ROUND(' + VS + R + '/' + VS + '$' + lMax + '*10,1),"")))';
        }
      } else {
        put(nt, r, cMP, s('', corpo(i, inativo)));
        if (vs) put(nt, r, cMF, s('', corpo(i, inativo)));
      }
      const fCh = aulas.length ? 'Chamada!' + U.encode_cell({ r: H + 1 + i, c: cF }) : '0';
      put(nt, r, cFal, n(st.faltas, corpo(i, inativo, { alignment: { horizontal: 'center' }, numFmt: '0.0' }), { f: fCh, z: '0.0' }));
      // A planilha não tem o aviso "perto do limite": a situação é só por falta e por nota.
      const sitNota = situacao(t, Object.assign({}, st, { limite: 0 }));
      const corSit = { RF: COR.F, VS: COR.A, BAIXA: COR.A, OK: COR.P }[sitNota.cod];
      const fFal = U.encode_cell({ r, c: cFal });
      let fSit = '""';
      if (usaveis.length) {
        const ramoVS = vs
          ? 'IF(' + fMP + '>=' + minVS + ',IF(ISNUMBER(' + colDe[vs.id] + R + '),IF(' + fMF + '>=' + minM + ',"Aprovado na VS","Reprovado na VS"),"Precisa de VS"),"Abaixo da média")'
          : '"Abaixo da média"';
        fSit = 'IF(' + fMP + '="","",IF(' + fMP + '>=' + minM + ',"Média suficiente",' + ramoVS + '))';
      }
      put(nt, r, cSit, {
        t: 's', v: sitNota.texto,
        s: corpo(i, inativo, corSit ? { font: { bold: true, color: { rgb: corSit[1] } }, fill: corSit[0] } : {}),
        f: 'IF(' + fFal + '>' + limite + ',"Reprovado por falta",' + fSit + ')'
      });
    });
    nt['!ref'] = U.encode_range({ s: { r: 0, c: 0 }, e: { r: NH + Math.max(alunos.length, 1), c: cSit } });
    nt['!cols'] = [{ wch: 11 }, { wch: 44 }, { wch: 22 }].concat(avs.map(() => ({ wch: 8 })))
      .concat(vs ? [{ wch: 7 }, { wch: 7 }] : [{ wch: 8 }]).concat([{ wch: 8 }, { wch: 20 }]);
    nt['!rows'] = [{ hpt: 24 }];
    U.book_append_sheet(wb, nt, 'Notas');

    // ---- Cronograma
    const cr = {};
    put(cr, 0, 0, s(titulo, ST.titulo()));
    ['Data', 'Dia', 'Tipo', 'Conteúdo', 'P', 'A', 'J', 'F'].forEach((h, c) => put(cr, 2, c, s(h, c === 3 ? ST.cabEsq() : ST.cab())));
    const todasAulas = aulasOrdenadas(t);
    todasAulas.forEach((aula, i) => {
      const r = 3 + i;
      const c = contarAula(t, aula);
      const feita = aulaRealizada(t, aula);
      const semAula = aula.tipo === 'sem-aula', aval = aula.tipo === 'avaliacao';
      const ex = extra => Object.assign({
        font: semAula ? { italic: true, color: { rgb: COR.inativo } } : aval ? { bold: true, color: { rgb: COR.A[1] } } : {},
        fill: aval ? COR.A[0] : undefined
      }, extra);
      put(cr, r, 0, n(isoToSerial(aula.data), corpo(i, false, ex({ numFmt: 'dd/mm/yyyy', alignment: { horizontal: 'center' } })), { z: 'dd/mm/yyyy' }));
      put(cr, r, 1, s(DIAS[weekday(aula.data)], corpo(i, false, ex(centro))));
      put(cr, r, 2, s(TIPOS[aula.tipo] || aula.tipo, corpo(i, false, ex(centro))));
      put(cr, r, 3, s(aula.conteudo || '', corpo(i, false, ex({ alignment: { wrapText: true } }))));
      ['P', 'A', 'J', 'F'].forEach((k, j) => {
        put(cr, r, 4 + j, feita
          ? n(c[k], corpo(i, false, { font: { bold: true, color: { rgb: COR[k][1] } }, alignment: { horizontal: 'center' } }))
          : s('', corpo(i, false, ex())));
      });
    });
    cr['!ref'] = U.encode_range({ s: { r: 0, c: 0 }, e: { r: 2 + Math.max(todasAulas.length, 1), c: 7 } });
    cr['!cols'] = [{ wch: 12 }, { wch: 6 }, { wch: 11 }, { wch: 50 }, { wch: 5 }, { wch: 5 }, { wch: 5 }, { wch: 5 }];
    cr['!rows'] = [{ hpt: 24 }];
    U.book_append_sheet(wb, cr, 'Cronograma');

    // ---- Alunos
    const al = {};
    put(al, 0, 0, s(titulo, ST.titulo()));
    ['Matrícula', 'CPF', 'Nome', 'E-mail', 'Curso', 'Ingresso', 'Situação', 'Origem']
      .forEach((h, c) => put(al, 2, c, s(h, c === 2 || c === 3 || c === 5 ? ST.cabEsq() : ST.cab())));
    alunos.forEach((a, i) => {
      const info = infoMatricula(a.matricula, cursos);
      [a.matricula, a.cpf || '', a.nome, a.email || '', info ? info.curso : '', info ? info.ingresso : '', situacaoTxt(a),
        { lista: 'lista oficial', manual: 'incluído à mão', planilha: 'planilha antiga' }[a.origem] || a.origem]
        .forEach((v, c) => put(al, 3 + i, c, s(v, corpo(i, !a.ativo, c === 2 || c === 3 || c === 5 ? {} : centro))));
    });
    al['!ref'] = U.encode_range({ s: { r: 0, c: 0 }, e: { r: 2 + Math.max(alunos.length, 1), c: 7 } });
    al['!cols'] = [{ wch: 11 }, { wch: 13 }, { wch: 44 }, { wch: 32 }, { wch: 26 }, { wch: 34 }, { wch: 26 }, { wch: 15 }];
    al['!rows'] = [{ hpt: 24 }];
    if (alunos.length) al['!autofilter'] = { ref: U.encode_range({ s: { r: 2, c: 0 }, e: { r: 2 + alunos.length, c: 7 } }) };
    U.book_append_sheet(wb, al, 'Alunos');

    // ---- Observações (justificativas etc.)
    const ob = {};
    put(ob, 0, 0, s(titulo, ST.titulo()));
    ['Data', 'Matrícula', 'Nome', 'Marcação', 'Observação'].forEach((h, c) => put(ob, 2, c, s(h, c === 2 || c === 4 ? ST.cabEsq() : ST.cab())));
    const porId = {};
    t.alunos.forEach(a => { porId[a.id] = a; });
    let ro = 3;
    todasAulas.forEach(aula => {
      const m = t.obs[aula.id] || {};
      Object.keys(m).forEach(aid => {
        const a = porId[aid];
        if (!a || !m[aid]) return;
        const v = (t.presencas[aula.id] || {})[aid];
        const i = ro - 3;
        put(ob, ro, 0, n(isoToSerial(aula.data), corpo(i, false, { numFmt: 'dd/mm/yyyy', alignment: { horizontal: 'center' } }), { z: 'dd/mm/yyyy' }));
        put(ob, ro, 1, s(a.matricula, corpo(i, false, centro)));
        put(ob, ro, 2, s(a.nome, corpo(i, false)));
        put(ob, ro, 3, v ? celStatus(v, STATUS_LABEL[v]) : s('', corpo(i, false)));
        put(ob, ro, 4, s(m[aid], corpo(i, false, { alignment: { wrapText: true } })));
        ro++;
      });
    });
    ob['!ref'] = U.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(ro - 1, 2), c: 4 } });
    ob['!cols'] = [{ wch: 12 }, { wch: 11 }, { wch: 40 }, { wch: 18 }, { wch: 50 }];
    ob['!rows'] = [{ hpt: 24 }];
    U.book_append_sheet(wb, ob, 'Observações');

    // ---- Configuração
    const cfg = {};
    put(cfg, 0, 0, s(titulo, ST.titulo()));
    const itens = [['Aulas previstas', aulasPrevistas(t)],
      ['Frequência mínima (%)', t.config.freqMin],
      ['Carga horária (h)', t.config.cargaHoraria || '—'],
      ['Horas por aula', t.config.horasAula || '—'],
      ['Máximo de faltas (reprova acima disso)', limite],
      ['Peso do atraso (em faltas)', peso],
      ['Média mínima', t.config.mediaMin],
      ['Lista oficial atualizada em', t.listaEm ? fmtDate(t.listaEm) : '—'],
      ['Exportado em', fmtDate(todayISO())]];
    itens.forEach(([k, v], i) => {
      put(cfg, 2 + i, 0, s(k, estilo({ font: { bold: true, color: { rgb: COR.cinza } }, fill: COR.claro })));
      put(cfg, 2 + i, 1, typeof v === 'number' ? n(v, estilo({ alignment: { horizontal: 'left' } })) : s(v, estilo()));
    });
    cfg['!ref'] = U.encode_range({ s: { r: 0, c: 0 }, e: { r: 1 + itens.length, c: 1 } });
    cfg['!cols'] = [{ wch: 38 }, { wch: 40 }];
    cfg['!rows'] = [{ hpt: 24 }];
    U.book_append_sheet(wb, cfg, 'Configuração');

    wb.SheetNames = wb.SheetNames.map(sheetName);
    return wb;
  }

  function nomeArquivo(t, ext) {
    const base = [t.periodo, t.codigo, t.turma].filter(Boolean).join('-') || norm(t.disciplina).replace(/\s+/g, '_');
    return base.replace(/[^\w.-]+/g, '_') + '-chamada.' + ext;
  }

  g.CC = {
    STATUS, STATUS_LABEL, TIPOS, TIPOS_AVALIACAO, DIAS, DEFAULT_CONFIG,
    uid, norm, titleCase, todayISO, addDays, weekday, fmtDate, cellToISO, numBR,
    parseWorkbook, novaTurma, nomeTurma, alunosOrdenados, aulasOrdenadas, findAluno,
    diffLista, aplicarLista, importarDados, gerarCronograma, aulaDaData, removerAula, removerAluno,
    aulaRealizada, contarAula, aulasPrevistas, limiteFaltas, reprovadoPorFalta, statsAluno, mediaAluno, mediaFinal, tipoFromConteudo,
    avaliacoesMedia, avaliacaoTipo, sincronizarAvaliacoes, aplicarPlano, planoPadrao,
    montarPlanilha, nomeArquivo, infoMatricula, cursosEncontrados, FORMAS_INGRESSO
  };
})(typeof window !== 'undefined' ? window : globalThis);
