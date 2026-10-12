/* ClassroomControl — projetos (instituição + departamento), disciplinas e calendário letivo.
 * Lógica pura (sem interface); estende window.CC.
 *
 *   db.projetos    [{ id, nome, instituicao, departamento, config, calendario: { '2026-2': { inicio, fim, eventos } } }]
 *   db.disciplinas [{ id, projetoId, codigo, nome, sigla, nivel, semAvulsos, pasta, config }]
 *   turma.projetoId, turma.disciplinaId (e cópias de nome, código, instituição, nível, sigla, para o resto do app)
 *
 * O projeto guarda as regras (frequência e médias) e o calendário; a disciplina, a carga horária e os
 * tipos de aula. As turmas novas herdam os dois; mudar no projeto ou na disciplina pode ser aplicado às turmas. */
(function (g) {
  'use strict';
  const CC = g.CC;
  const { norm, uid, addDays, fmtDate, periodoCurto, siglaDisciplina } = CC;

  const NIVEIS = { grad: 'Graduação', pos: 'Pós-graduação', outro: 'Outro' };
  const REGRAS = ['freqMin', 'pesoAtraso', 'mediaMin', 'mediaVS', 'mediaMinPos'];     // do projeto
  const AULAS = ['cargaHoraria', 'horasAula', 'categorias', 'categoriaDia'];          // da disciplina

  const iso = (y, m, d) => y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');

  /* ---------- projetos e disciplinas ---------- */

  function novoProjeto(d) {
    const inst = String(d.instituicao || '').trim();
    return {
      id: uid('p'), nome: String(d.nome || '').trim() || [inst, d.departamento].filter(Boolean).join(' · ') || 'Projeto',
      instituicao: inst, departamento: String(d.departamento || '').trim(), config: {}, calendario: {}
    };
  }

  function novaDisciplina(projetoId, d) {
    return {
      id: uid('c'), projetoId, codigo: d.codigo || '', nome: d.nome || '', sigla: d.sigla || '', departamento: d.departamento || '',
      nivel: d.nivel || 'grad', nivelFixo: !!d.nivelFixo, semAvulsos: !!d.semAvulsos, pasta: d.pasta || '', config: {}
    };
  }

  const pareceCodigo = s => /^[A-Z]{3}\d{5}$/i.test(String(s || '').trim());

  /** Departamento pelo prefixo do código da UFF: TCC00305 → TCC. */
  function deptoDoCodigo(c) {
    const m = String(c || '').trim().match(/^([A-Z]{3})\d*$/i);
    return m ? m[1].toUpperCase() : '';
  }

  const MINUSCULAS = new Set(['A', 'O', 'AS', 'OS', 'À', 'ÀS', 'AO', 'AOS', 'E', 'DE', 'DA', 'DO', 'DAS', 'DOS', 'EM', 'NA', 'NO', 'NAS', 'NOS', 'PARA', 'COM', 'POR']);

  /** "TÓPICOS ESPECIAIS EM SEGURANÇA DA INFORMAÇÃO II" → "Tópicos Especiais em Segurança da Informação II". */
  function tituloDisciplina(s) {
    const ws = String(s || '').trim().split(/\s+/);
    if (ws.length === 1 && ws[0].length <= 5) return ws[0];          // sigla: EMG
    return ws.map((w, i) => {
      const u = w.toUpperCase(), nu = u.replace(/[()]/g, '');
      if (/^(I|II|III|IV|V|VI|VII|VIII|IX|X)$/.test(nu)) return u;   // algarismos romanos
      if (/^\(.{1,4}\)$/.test(w)) return u;                          // (SI)
      if (i > 0 && MINUSCULAS.has(u)) return w.toLowerCase();
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    }).join(' ');
  }

  const acentos = s => (s.normalize('NFD').match(/[̀-ͯ]/g) || []).length;

  /** Melhor nome entre os das turmas: o mais comum, preferindo a grafia com minúsculas e com acentos; nunca um código. */
  function melhorNome(nomes) {
    const bons = nomes.map(n => String(n || '').trim()).filter(n => n && !pareceCodigo(n) && n !== 'Nova turma');
    if (!bons.length) return '';
    const cont = new Map();
    bons.forEach(n => cont.set(norm(n), (cont.get(norm(n)) || 0) + 1));
    const chave = Array.from(cont.keys()).sort((a, b) => cont.get(b) - cont.get(a))[0];
    const nota = n => acentos(n) * 10 + (n !== n.toUpperCase() ? 1 : 0);
    const melhor = bons.filter(n => norm(n) === chave).sort((a, b) => nota(b) - nota(a))[0];
    return melhor !== melhor.toUpperCase() ? melhor : tituloDisciplina(melhor);
  }

  // Nomes que as turmas traziam antes de receber o da disciplina (para escolher o melhor ao importar).
  const nomesVistos = new WeakMap();

  /** Disciplinas "Tópicos especiais/avançados…" não aceitam alunos avulsos. */
  const ehTopicos = nome => /\bTOPICOS\b/.test(norm(nome));

  /** Nível pela maioria dos alunos (matrícula da pós ou CPF provisório = pós). */
  function nivelPelosAlunos(turmas) {
    let pos = 0, n = 0;
    turmas.forEach(t => {
      const semNivel = Object.assign({}, t, { nivel: '' });
      t.alunos.forEach(a => { n++; if (CC.nivelAluno(semNivel, a) === 'pos') pos++; });
    });
    return n && pos > n / 2 ? 'pos' : 'grad';
  }

  function projetoDe(db, t) { return (db.projetos || []).find(p => p.id === t.projetoId) || null; }
  function disciplinaDe(db, t) { return (db.disciplinas || []).find(d => d.id === t.disciplinaId) || null; }
  function turmasDaDisciplina(db, d) { return db.turmas.filter(t => t.disciplinaId === d.id); }
  function disciplinasDoProjeto(db, p) { return (db.disciplinas || []).filter(d => d.projetoId === p.id); }

  /** Projeto para uma instituição (e departamento); cria se não houver. Instituição vazia = UFF. */
  function projetoPara(db, instituicao, departamento) {
    const inst = String(instituicao || '').trim() || 'UFF';
    const cands = db.projetos.filter(p => norm(p.instituicao || 'UFF') === norm(inst));
    let p = (departamento && cands.find(x => norm(x.departamento) === norm(departamento))) || cands[0];
    if (!p) { p = novoProjeto({ instituicao: inst, departamento: departamento || '' }); db.projetos.push(p); }
    return p;
  }

  /** Disciplina do projeto para a turma: pela pasta (importação de pasta), pelo código ou, sem código, pelo nome. */
  function disciplinaPara(db, p, t, o) {
    const ds = disciplinasDoProjeto(db, p);
    let d = (o.disciplinaId && ds.find(x => x.id === o.disciplinaId)) || (o.pasta ? ds.find(x => x.pasta === o.pasta) : null);
    if (!d) {
      let mesmas = t.codigo ? ds.filter(x => x.codigo === t.codigo) : ds.filter(x => !x.codigo && norm(x.nome) === norm(melhorNome([t.disciplina]) || t.disciplina));
      if (o.pasta) mesmas = mesmas.filter(x => !x.pasta);
      d = mesmas.length < 2 ? mesmas[0]
        : mesmas.find(x => t.tema && x.sigla && norm(x.sigla) === norm(siglaDisciplina(t.tema))) ||
          mesmas.find(x => norm(x.nome) === norm(t.disciplina)) || mesmas[0];
    }
    if (!d) {
      d = novaDisciplina(p.id, {
        codigo: t.codigo, nome: melhorNome([t.disciplina]) || t.disciplina || t.codigo, sigla: o.sigla || '', pasta: o.pasta || '',
        departamento: o.departamento || deptoDoCodigo(t.codigo),
        nivel: o.nivel || nivelPelosAlunos([t]), nivelFixo: !!o.nivel, semAvulsos: ehTopicos(t.disciplina)
      });
      ['cargaHoraria', 'horasAula'].forEach(k => { if (t.config && t.config[k]) d.config[k] = t.config[k]; });
      db.disciplinas.push(d);
    } else {
      if (o.pasta && !d.pasta) d.pasta = o.pasta;
      if (o.sigla && !d.sigla) d.sigla = o.sigla;
      if (!d.codigo && t.codigo) d.codigo = t.codigo;
    }
    return d;
  }

  /** Copia para a turma o que vem do projeto e da disciplina (nome, código, instituição, nível…). */
  function copiarParaTurma(t, p, d) {
    t.projetoId = p.id;
    t.disciplinaId = d.id;
    t.instituicao = p.instituicao;
    if (d.nome) t.disciplina = d.nome;
    if (d.codigo) t.codigo = d.codigo;
    t.nivel = d.nivel || 'grad';
    if (d.semAvulsos) t.semAvulsos = true; else delete t.semAvulsos;
    if (d.sigla) t.sigla = d.sigla; else delete t.sigla;
  }

  /**
   * Põe a turma num projeto e numa disciplina. o = { projetoId, disciplinaId, pasta, sigla, departamento, nivel }.
   * Sem projetoId, usa (ou cria) o projeto da instituição da turma.
   */
  function vincularTurma(db, t, o) {
    o = o || {};
    const p = (o.projetoId && db.projetos.find(x => x.id === o.projetoId)) || projetoPara(db, t.instituicao, o.departamento);
    const d = disciplinaPara(db, p, t, o);
    if (!nomesVistos.has(d)) nomesVistos.set(d, []);
    nomesVistos.get(d).push(t.disciplina);
    copiarParaTurma(t, p, d);
    return { p, d };
  }

  /** Atualiza nome (pelo das turmas) e nível (pelos alunos) de disciplinas recém-criadas por importação. */
  function ajustarDisciplina(db, d) {
    const ts = turmasDaDisciplina(db, d);
    if (!ts.length) return;
    const vistos = nomesVistos.get(d) || [];
    const nome = melhorNome(vistos.length ? vistos : ts.map(t => t.disciplina).concat(d.nome));
    if (nome) d.nome = nome;
    if (!d.nivelFixo) d.nivel = nivelPelosAlunos(ts);
    d.semAvulsos = d.semAvulsos || ehTopicos(d.nome);
    const p = db.projetos.find(x => x.id === d.projetoId);
    ts.forEach(t => copiarParaTurma(t, p, d));
  }

  /** Muda a disciplina (ou o projeto) e repassa às turmas. */
  function sincronizarDisciplina(db, d) {
    const p = db.projetos.find(x => x.id === d.projetoId);
    turmasDaDisciplina(db, d).forEach(t => copiarParaTurma(t, p, d));
  }

  /** Configuração inicial de uma turma nova: padrão do app + regras do projeto + aulas da disciplina. */
  function configPadrao(p, d) {
    const c = Object.assign({}, CC.DEFAULT_CONFIG);
    if (p) REGRAS.forEach(k => { if (p.config && p.config[k] !== undefined) c[k] = p.config[k]; });
    if (d) AULAS.forEach(k => { if (d.config && d.config[k] !== undefined) c[k] = JSON.parse(JSON.stringify(d.config[k])); });
    return c;
  }

  /** Garante projetos e disciplinas (bancos antigos: um projeto por instituição; disciplina pelo código). */
  function organizar(db) {
    db.projetos = db.projetos || [];
    db.disciplinas = db.disciplinas || [];
    db.projetos.forEach(p => { p.config = p.config || {}; p.calendario = p.calendario || {}; });
    db.disciplinas.forEach(d => { d.config = d.config || {}; });
    const novas = new Set();
    db.turmas.forEach(t => {
      const p = projetoDe(db, t), d = disciplinaDe(db, t);
      if (p && d && d.projetoId === p.id) return;
      const antes = db.disciplinas.length;
      const r = vincularTurma(db, t, p ? { projetoId: p.id } : {});
      if (db.disciplinas.length > antes) novas.add(r.d);
    });
    novas.forEach(d => ajustarDisciplina(db, d));
    return db;
  }

  /** Remove disciplinas sem turmas (depois de mover ou excluir turmas). */
  function limparDisciplinas(db) {
    db.disciplinas = db.disciplinas.filter(d => db.turmas.some(t => t.disciplinaId === d.id) || d.manter);
  }

  /** Pasta da disciplina no padrão de LK-UFF-aulas: "UFF-TCC00305-LFTC" → instituição, código (ou departamento), sigla. */
  function lerNomePasta(nome) {
    const m = String(nome || '').match(/^([A-Za-z]{2,10})-([A-Za-z]{3}\d{0,6})-(.+)$/);
    if (!m) return null;
    const cod = m[2].toUpperCase();
    return { instituicao: m[1].toUpperCase(), codigo: /\d/.test(cod) ? cod : '', departamento: cod.slice(0, 3), sigla: m[3] };
  }

  /** Período no padrão dos nomes de arquivo: '20262' → '2026b'. */
  function periodoLetra(per) {
    const c = periodoCurto(per);
    return /^\d{4}-[12]$/.test(c) ? c.slice(0, 4) + (c[5] === '1' ? 'a' : 'b') : c;
  }

  /* ---------- calendário letivo ---------- */

  /** Chave do período no calendário: '2026-2' (vazio se o período da turma não tiver esse formato). */
  function chavePeriodo(per) {
    const c = periodoCurto(per);
    return /^\d{4}-[12]$/.test(c) ? c : '';
  }

  function calendarioDe(db, t) {
    const p = projetoDe(db, t), k = chavePeriodo(t.periodo);
    return (p && k && p.calendario[k]) || null;
  }

  /** Evento sem aula que cobre a data (ou null). */
  function semAulaEm(cal, data) {
    if (!cal) return null;
    return (cal.eventos || []).find(e => e.semAula && data >= e.data && data <= (e.ate || e.data)) || null;
  }

  const fmt = d => fmtDate(d);
  function linhaEvento(e) {
    return (e.semAula ? '' : '* ') + fmt(e.data) + (e.ate && e.ate !== e.data ? ' a ' + fmt(e.ate) : '') + ' ' + (e.descricao || '');
  }

  /** Eventos como texto, um por linha ("* " = aviso, não cancela aula). */
  function eventosParaTexto(eventos) {
    return ordenarEventos(eventos).map(linhaEvento).join('\n');
  }

  function ordenarEventos(eventos) {
    return (eventos || []).slice().sort((a, b) => a.data.localeCompare(b.data) || (a.ate || '').localeCompare(b.ate || ''));
  }

  /**
   * Lê o texto do editor: "dd/mm[/aaaa][ a dd/mm[/aaaa]] descrição". Sem ano, usa o do início do período
   * (ou o seguinte, para datas do 2º semestre que passam de dezembro). Devolve { eventos, erros }.
   */
  function textoParaEventos(txt, inicio) {
    const ano0 = parseInt(String(inicio || '').slice(0, 4), 10) || new Date().getFullYear();
    const mes0 = parseInt(String(inicio || '').slice(5, 7), 10) || 1;
    const data = (d, m, a) => {
      let y = a ? +a : ano0;
      if (y < 100) y += 2000;
      if (!a && inicio && +m < mes0 - 2) y++;
      if (+m < 1 || +m > 12 || +d < 1 || +d > 31) return null;
      return iso(y, +m, +d);
    };
    const eventos = [], erros = [];
    String(txt || '').split(/\r?\n/).forEach(l => {
      if (!l.trim()) return;
      const m = l.match(/^\s*(\*)?\s*(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?:\s*(?:a|até|-|–|—)\s*(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?)?\s*[-–—:]?\s*(.*)$/i);
      const ini = m && data(m[2], m[3], m[4]);
      if (!ini) { erros.push(l.trim()); return; }
      let fim = m[5] ? data(m[5], m[6], m[7] || m[4]) : null;
      if (fim && fim < ini && !m[7]) fim = (+fim.slice(0, 4) + 1) + fim.slice(4);   // "20/12 a 05/01
      eventos.push({ data: ini, ate: fim && fim !== ini ? fim : '', descricao: m[8].trim() || (m[1] ? 'Aviso' : 'Sem aula'), semAula: !m[1] });
    });
    return { eventos: ordenarEventos(eventos), erros };
  }

  /** Junta eventos sem repetir a mesma data com a mesma descrição. */
  function juntarEventos(a, b) {
    const out = (a || []).slice();
    (b || []).forEach(e => {
      const igual = out.find(x => x.data === e.data && (x.ate || '') === (e.ate || '') && (norm(x.descricao) === norm(e.descricao) || (x.semAula && e.semAula)));
      if (!igual) out.push(e);
    });
    return ordenarEventos(out);
  }

  /** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher). */
  function pascoa(ano) {
    const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4;
    const f = Math.floor((b + 8) / 25), gg = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - gg + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
    return iso(ano, mes, dia);
  }

  /** Feriados e pontos facultativos de um ano. o = { rj, niteroi, professor }.
   *  A UFF publica a lista oficial do ano numa resolução própria (lida por feriadosDoTexto); esta é a previsão. */
  function feriadosDoAno(ano, o) {
    o = o || {};
    const P = pascoa(ano);
    const F = (m, d, descricao, semAula) => ({ data: iso(ano, m, d), ate: '', descricao, semAula: semAula !== false });
    const lista = [
      F(1, 1, 'Confraternização Universal'),
      { data: addDays(P, -48), ate: addDays(P, -47), descricao: 'Carnaval (ponto facultativo)', semAula: true },
      { data: addDays(P, -46), ate: '', descricao: 'Quarta-feira de Cinzas (ponto facultativo até as 14h)', semAula: false },
      { data: addDays(P, -2), ate: '', descricao: 'Paixão de Cristo', semAula: true },
      F(4, 21, 'Tiradentes'),
      F(5, 1, 'Dia do Trabalho'),
      { data: addDays(P, 60), ate: '', descricao: 'Corpus Christi (ponto facultativo)', semAula: true },
      F(9, 7, 'Independência do Brasil'),
      F(10, 12, 'Nossa Senhora Aparecida'),
      F(10, 28, 'Dia do Servidor Público (ponto facultativo; confira a data no ano)', false),
      F(11, 2, 'Finados'),
      F(11, 15, 'Proclamação da República'),
      F(12, 25, 'Natal')
    ];
    if (ano >= 2024) lista.push(F(11, 20, 'Dia Nacional de Zumbi e da Consciência Negra'));
    if (o.rj) {
      lista.push(F(4, 23, 'São Jorge (feriado estadual – RJ)'));
      if (ano < 2024) lista.push(F(11, 20, 'Consciência Negra (feriado estadual – RJ)'));
    }
    if (o.professor) lista.push(F(10, 15, 'Dia do Professor (feriado escolar na UFF)'));
    if (o.niteroi) {
      lista.push(F(6, 24, 'São João Batista, padroeiro de Niterói (feriado municipal)'));
      // Lei Municipal nº 3.511/2020: a partir de 2021, o aniversário da cidade deixou de ser feriado.
      if (ano <= 2020) lista.push(F(11, 22, 'Aniversário de Niterói (feriado municipal)'));
    }
    return ordenarEventos(lista);
  }

  /** Feriados entre duas datas (ou no ano inteiro de `ini`, sem fim). */
  function feriadosEntre(ini, fim, o) {
    const a0 = +String(ini).slice(0, 4), a1 = fim ? +String(fim).slice(0, 4) : a0;
    let out = [];
    for (let a = a0; a <= a1; a++) out = out.concat(feriadosDoAno(a, o));
    return out.filter(e => (!ini || (e.ate || e.data) >= ini) && (!fim || e.data <= fim));
  }

  /** Calendário deduzido dos cronogramas das turmas: { '2026-2': { inicio, fim, eventos } }. */
  function calendarioDasTurmas(turmas) {
    const out = {};
    turmas.forEach(t => {
      const k = chavePeriodo(t.periodo);
      if (!k) return;
      const aulas = CC.aulasOrdenadas(t);
      const dadas = aulas.filter(a => a.tipo !== 'sem-aula');
      if (!aulas.length) return;
      const c = out[k] || (out[k] = { inicio: '', fim: '', eventos: [] });
      const ini = t.config.inicio || (dadas[0] || aulas[0]).data;
      const fim = t.config.fim || (dadas[dadas.length - 1] || aulas[aulas.length - 1]).data;
      if (!c.inicio || ini < c.inicio) c.inicio = ini;
      if (!c.fim || fim > c.fim) c.fim = fim;
      aulas.filter(a => a.tipo === 'sem-aula').forEach(a => {
        if (!c.eventos.some(e => e.data === a.data)) c.eventos.push({ data: a.data, ate: '', descricao: a.conteudo || 'Sem aula', semAula: true });
      });
    });
    Object.values(out).forEach(c => { c.eventos = ordenarEventos(c.eventos); });
    return out;
  }

  /**
   * Marca como "sem aula" as aulas (ainda sem chamada) que caem num feriado/recesso do calendário.
   * Devolve quantas mudou.
   */
  function aplicarCalendario(t, cal) {
    if (!cal) return 0;
    let n = 0;
    t.aulas.forEach(a => {
      if (a.tipo === 'sem-aula' || CC.aulaRealizada(t, a)) return;
      const e = semAulaEm(cal, a.data);
      if (!e) return;
      a.tipo = 'sem-aula';
      if (!a.conteudo) a.conteudo = e.descricao;
      n++;
    });
    return n;
  }

  /* ---------- calendário a partir do texto de um PDF ---------- */

  const RE_DATA = /(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})\b/;
  const RE_INTERVALO = new RegExp('(?:(\\d{1,2})\\s*(?:a|e)\\s*)?' + RE_DATA.source + '(?:\\s*(?:a|até|e|-|–)\\s*' + RE_DATA.source + ')?', 'gi');
  const IGNORAR_LINHA = /BOLETIM DE SERVI|SE[CÇ][AÃ]O\s+[IVX]+\s+P\.|^\s*ANO\s+[IVXLC]+\s+[–-]/i;
  const SEM_AULA = /FERIADO|RECESSO|PONTO FACULTATIVO|CARNAVAL|PAIXAO|CORPUS CHRISTI|SEM ATIVIDADES|SUSPENSAO DAS (AULAS|ATIVIDADES)/;
  // Avisos que interessam ao professor (o resto do calendário administrativo fica de fora).
  const AVISO = /LANCAMENTO DE NOTAS|DIARIO DE CLASSE|DIARIO|TRANCAMENTO|ALTERACOES NOS PLANOS|VERIFICACAO SUPLEMENTAR|AGENDA ACADEMICA|SEMANA ACADEMICA|ACOLHIMENTO/;
  const NAO_AVISO = /PROCESSAMENTO|PREPARACAO DO SISTEMA|COORDENACAO|ACERTOS/;

  /** O texto do PDF às vezes quebra as datas: "11 /12/2026", "0 9/01/202 6". */
  function juntarDatas(l) {
    if (!l.includes('/')) return l;
    return l.replace(/(\d)\s+(?=\/\d)/g, '$1').replace(/(\d\/)\s+(?=\d)/g, '$1')
      .replace(/(\d)\s+(\d\/\d)/g, '$1$2').replace(/(\/\d{3})\s+(\d)(?!\d)/g, '$1$2');
  }

  /** Datas de uma linha: [{ ini, fim }] e o texto sem elas. */
  function datasDaLinha(l) {
    const ds = [];
    const y4 = y => (+y < 100 ? 2000 + +y : +y);
    const texto = l.replace(RE_INTERVALO, (_, d0, d1, m1, y1, d2, m2, y2) => {
      if (+m1 < 1 || +m1 > 12) return _;
      const a = iso(y4(y1), +m1, +(d0 || d1));
      const b = d2 ? iso(y4(y2), +m2, +d2) : d0 ? iso(y4(y1), +m1, +d1) : '';
      ds.push({ ini: a, fim: b && b > a ? b : '' });
      return ' ';
    });
    return { ds, texto: texto.replace(/\s+/g, ' ').replace(/^[\s–—:-]+|[\s–—:-]+$/g, '').trim() };
  }

  /**
   * Calendário escolar (texto extraído do PDF, uma string por linha) → { '2026-1': { inicio, fim, eventos }, … }.
   * Reconhece o quadro da UFF (Evento | 1º período letivo | 2º período letivo) e listas de feriados.
   * O resultado é só uma sugestão: o professor revê antes de salvar.
   */
  function calendarioDoTexto(linhas) {
    const itens = [];
    let rotulo = [], secao = '', duasColunas = false, ultimo = null;
    linhas.forEach(bruta => {
      const l = juntarDatas(String(bruta || '').replace(/\s+/g, ' ').trim());
      if (!l || IGNORAR_LINHA.test(l)) return;
      if (/1\s*[ºo°]\s*(PER[IÍ]ODO|SEMESTRE).*2\s*[ºo°]\s*(PER[IÍ]ODO|SEMESTRE)/i.test(l)) { duasColunas = true; ultimo = null; return; }
      const { ds, texto } = datasDaLinha(l);
      const numerado = /^\d+(\.\d+)*\.?\s+\S/.test(texto);
      if (/^\d+\.\s+\D/.test(texto)) secao = texto;          // título de seção: "16. PERÍODOS LETIVOS REGULARES…"
      if (!ds.length) {
        if (numerado) { rotulo = [texto]; ultimo = null; }
        else if (ultimo && texto && texto !== texto.toUpperCase() && ultimo.cont++ < 2) ultimo.desc = (ultimo.desc + ' ' + texto).slice(0, 140);   // continuação do item anterior (títulos em maiúsculas, não)
        else if (texto === texto.toUpperCase() && texto.length > 8) { ultimo = null; rotulo = []; }
        else if (texto) rotulo = rotulo.concat(texto).slice(-3);
        return;
      }
      const desc = (numerado || !rotulo.length ? texto : rotulo.join(' ') + ' ' + texto)
        .replace(/^\d+(\.\d+)*\.?\s*/, '').replace(/\s+/g, ' ').trim();
      rotulo = [];
      ultimo = { desc, secao, ds, duas: duasColunas && ds.length === 2, cont: 0 };
      itens.push(ultimo);
    });

    // Períodos letivos: o quadro "Períodos letivos regulares" (linha "Demais cursos") ou "início/término do … período".
    const per = { 1: {}, 2: {} };
    const qualSem = s => /\b(1\s*[ºo°]|PRIMEIRO)\b/.test(s) ? 1 : /\b(2\s*[ºo°]|SEGUNDO)\b/.test(s) ? 2 : 0;
    const quadro = itens.find(i => /PERIODOS? LETIVOS?/.test(norm(i.secao + ' ' + i.desc)) && !/MEDICINA/.test(norm(i.desc)) && i.ds.some(d => d.fim));
    if (quadro) {
      const comFim = quadro.ds.filter(d => d.fim);
      if (comFim.length >= 2) { per[1] = { inicio: comFim[0].ini, fim: comFim[0].fim }; per[2] = { inicio: comFim[1].ini, fim: comFim[1].fim }; }
      else per[+comFim[0].ini.slice(5, 7) <= 7 ? 1 : 2] = { inicio: comFim[0].ini, fim: comFim[0].fim };
    }
    itens.forEach(i => {
      const n = norm(i.desc);
      const s = qualSem(n);
      if (!s || !/PERIODO|SEMESTRE|AULAS/.test(n)) return;
      if (/\bINICIO\b/.test(n) && !per[s].inicio) per[s].inicio = i.ds[0].ini;
      if (/\b(TERMINO|FIM|ENCERRAMENTO)\b/.test(n) && !per[s].fim) per[s].fim = i.ds[0].fim || i.ds[0].ini;
    });
    const ano = (per[1].inicio || per[2].inicio || (itens[0] && itens[0].ds[0].ini) || '').slice(0, 4);
    if (!ano) return {};
    const chave = s => ano + '-' + s;
    const out = {};
    [1, 2].forEach(s => { if (per[s].inicio || per[s].fim) out[chave(s)] = { inicio: per[s].inicio || '', fim: per[s].fim || '', eventos: [] }; });

    const semDaData = d => {
      for (const s of [1, 2]) if (per[s].inicio && per[s].fim && d >= addDays(per[s].inicio, -20) && d <= addDays(per[s].fim, 20)) return s;
      if (+d.slice(0, 4) > +ano) return 2;
      return +d.slice(5, 7) <= 7 ? 1 : 2;
    };
    const vistos = new Set();
    itens.forEach(i => {
      if (i === quadro) return;
      const n = norm(i.desc);
      const semAula = SEM_AULA.test(n) || SEM_AULA.test(norm(i.secao));   // item ou seção de feriados/recesso
      if (!semAula && (!AVISO.test(n) || NAO_AVISO.test(n))) return;
      const chaveItem = i.ds.map(d => d.ini + d.fim).join() + n.slice(0, 40);   // o anexo administrativo repete itens
      if (vistos.has(chaveItem)) return;
      vistos.add(chaveItem);
      i.ds.forEach((d, k) => {
        const s = i.duas ? k + 1 : semDaData(d.ini);
        const c = out[chave(s)] || (out[chave(s)] = { inicio: '', fim: '', eventos: [] });
        c.eventos.push({ data: d.ini, ate: d.fim, descricao: i.desc.slice(0, 90) || (semAula ? 'Sem aula' : 'Aviso'), semAula });
      });
    });
    Object.values(out).forEach(c => { c.eventos = juntarEventos([], c.eventos); });
    return out;
  }

  const MESES = { JANEIRO: 1, FEVEREIRO: 2, MARCO: 3, ABRIL: 4, MAIO: 5, JUNHO: 6, JULHO: 7, AGOSTO: 8, SETEMBRO: 9, OUTUBRO: 10, NOVEMBRO: 11, DEZEMBRO: 12 };

  /**
   * Resolução de feriados e pontos facultativos da UFF (texto do PDF): lista em alíneas,
   * "a) 1º de janeiro, Confraternização Universal (feriado nacional);". Dos feriados municipais,
   * só os do município dado (ex.: "Niterói"). Devolve { ano, eventos } ou null.
   */
  function feriadosDoTexto(linhas, municipio) {
    const ls = linhas.map(l => String(l || '').replace(/\s+/g, ' ').trim()).filter(l => l && !IGNORAR_LINHA.test(l));
    const tudo = norm(ls.join(' '));
    const mAno = tudo.match(/FERIADOS E PONTOS FACULTATIVOS[\s\S]{0,300}?ANO (?:CIVIL )?DE (\d{4})/);
    if (!mAno) return null;
    const ano = +mAno[1];
    const itens = [];
    let secao = '', atual = null;
    ls.forEach(l => {
      if (/^[IVX][IVX ]*\s*[–-]\s/.test(l)) { secao = norm(l); atual = null; return; }
      if (/^Art\.\s*\d/.test(l)) { secao = ''; atual = null; return; }   // "Art. 2º" (não "art. 3º e o art. 5º da Portaria…")
      if (!/FERIADO/.test(secao)) return;
      const a = l.match(/^[a-z]\)\s*(.*)$/);
      if (a) { atual = { texto: a[1], municipal: /MUNICIPA/.test(secao) }; itens.push(atual); }
      else if (atual) atual.texto += ' ' + l;
    });
    const eventos = [];
    const RE_DIA = /(\d{1,2})\s*[ºo°]?\s+de\s+([A-Za-zçÇ]+)/g;
    itens.forEach(i => {
      const pref = i.texto.match(/^\d{1,2}\s*[ºo°]?\s+de\s+[A-Za-zçÇ]+(?:\s*(?:,|e|a)\s*\d{1,2}\s*[ºo°]?\s+de\s+[A-Za-zçÇ]+)*/);
      if (!pref) return;
      const datas = [];
      let m;
      RE_DIA.lastIndex = 0;
      while ((m = RE_DIA.exec(pref[0]))) { const mes = MESES[norm(m[2])]; if (mes) datas.push(iso(ano, mes, +m[1])); }
      if (!datas.length) return;
      let desc = i.texto.slice(pref[0].length).replace(/^[\s,;:–-]+/, '').replace(/[\s;.]+(e)?\s*$/, '').trim();
      if (/^\(.*\)$/.test(desc)) desc = desc.slice(1, -1);
      desc = desc ? desc.charAt(0).toUpperCase() + desc.slice(1) : 'Ponto facultativo';
      if (i.municipal) {
        if (!municipio || !norm(desc).includes(norm(municipio))) return;
        desc = 'Feriado municipal – ' + desc;
      }
      // Datas seguidas viram um intervalo (Carnaval: 16 e 17 de fevereiro).
      datas.sort();
      let ini = datas[0], fim = datas[0];
      datas.slice(1).concat(['']).forEach(d => {
        if (d && d === addDays(fim, 1)) { fim = d; return; }
        eventos.push({ data: ini, ate: fim !== ini ? fim : '', descricao: desc, semAula: true });
        ini = fim = d;
      });
    });
    if (/15 DE OUTUBRO,? DIA DO PROFESSOR/.test(tudo)) eventos.push({ data: iso(ano, 10, 15), ate: '', descricao: 'Dia do Professor (feriado escolar)', semAula: true });
    return eventos.length ? { ano, eventos: juntarEventos([], eventos) } : null;
  }

  Object.assign(CC, {
    feriadosDoTexto,
    NIVEIS, REGRAS, AULAS, novoProjeto, novaDisciplina, melhorNome, tituloDisciplina, deptoDoCodigo, ehTopicos, nivelPelosAlunos,
    projetoDe, disciplinaDe, turmasDaDisciplina, disciplinasDoProjeto, projetoPara, vincularTurma, ajustarDisciplina,
    sincronizarDisciplina, configPadrao, organizar, limparDisciplinas, lerNomePasta, periodoLetra,
    chavePeriodo, calendarioDe, semAulaEm, eventosParaTexto, linhaEvento, textoParaEventos, juntarEventos, ordenarEventos,
    pascoa, feriadosDoAno, feriadosEntre, calendarioDasTurmas, aplicarCalendario, calendarioDoTexto, datasDaLinha
  });
})(typeof window !== 'undefined' ? window : globalThis);
