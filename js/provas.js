/* ClassroomControl — provas detalhadas: questões e subitens (valor máximo, descrição, regra de pontuação),
 * nota de cada aluno por subitem, modelo da prova, presença, colunas extras (ex.: Lápis, Alertas) e
 * justificativas da correção. Lógica pura; estende window.CC.
 *
 *   avaliacao.detalhe = {
 *     titulo, rodape, criterioNota,
 *     questoes: [{ nome: 'Q1', titulo: 'Fundamentos', descricao, regra, itens: [{ id, nome: '1a', max: 0.6, descricao, regra }] }],
 *     extras: ['Lápis', 'Alertas'],            // colunas de texto por aluno
 *     textos: ['Q1', …, 'Observações'],        // colunas da aba de justificativas
 *     alunos: { [alunoId]: { situacao: 'Presente'|'Ausente', modelo, itens: { [itemId]: nota }, extras: {}, textos: {} } }
 *   }
 * A nota da avaliação (t.notas) é a soma dos subitens; aluno ausente fica sem nota. */
(function (g) {
  'use strict';
  const CC = g.CC;
  const { norm, uid, numBR } = CC;

  const r2 = x => Math.round(x * 100) / 100;
  const num = v => {
    if (typeof v === 'number') return v;
    if (v == null) return null;
    const x = parseFloat(String(v).trim().replace(',', '.'));
    return isNaN(x) ? null : x;
  };
  const txt = v => (v == null ? '' : String(v).trim());

  /* ---------- totais ---------- */

  function itensDe(det) {
    const out = [];
    (det.questoes || []).forEach(q => q.itens.forEach(it => out.push(Object.assign({ q }, it))));
    return out;
  }

  function maxDetalhe(det) {
    return r2(itensDe(det).reduce((s, it) => s + (it.max || 0), 0));
  }

  const maxQuestao = q => r2(q.itens.reduce((s, it) => s + (it.max || 0), 0));

  /** Aluno ausente, sem registro ou sem nenhuma nota de subitem: null. */
  function totalQuestao(det, alunoId, q) {
    const d = det.alunos[alunoId];
    if (!d || d.situacao === 'Ausente') return null;
    const vals = q.itens.map(it => d.itens[it.id]).filter(x => typeof x === 'number');
    return vals.length ? r2(vals.reduce((s, x) => s + x, 0)) : null;
  }

  function totalAluno(det, alunoId) {
    const ts = det.questoes.map(q => totalQuestao(det, alunoId, q)).filter(x => x != null);
    return ts.length ? r2(ts.reduce((s, x) => s + x, 0)) : null;
  }

  /** Passa a soma dos subitens para as notas da avaliação (e o máximo da prova para a avaliação). */
  function sincronizarNotasDetalhe(t, v) {
    const det = v.detalhe;
    if (!det) return;
    const m = maxDetalhe(det);
    if (m > 0) v.max = m;
    const notas = t.notas[v.id] || (t.notas[v.id] = {});
    Object.keys(det.alunos).forEach(aid => {
      const tot = totalAluno(det, aid);
      if (tot == null) delete notas[aid]; else notas[aid] = tot;
    });
  }

  /* ---------- leitura da planilha de correção ---------- */

  const ehMax = v => /^(VALOR|NOTA|PONTUACAO|PONTOS)?\s*MAX/.test(norm(v));
  const ehTotal = v => /^(TOTAL|SUBTOTAL|SOMA)\b/.test(norm(v));
  const ehNota = v => /^NOTA\b/.test(norm(v)) && !ehMax(v);

  /** "Q1 — Fundamentos" → { nome: 'Q1', titulo: 'Fundamentos' }. */
  function separarQuestao(s) {
    const m = txt(s).match(/^(.+?)\s+[—–-]\s+(.+)$/) || txt(s).match(/^([^:]{1,12}):\s*(.+)$/);
    return m ? { nome: m[1].trim(), titulo: m[2].trim() } : { nome: txt(s), titulo: '' };
  }

  /** Aba de notas por subitem: tem uma linha "Valor máximo" e, acima, o cabeçalho com matrícula e nome. */
  function lerAbaNotas(m) {
    // A aba "Notas" do próprio app (linhas Peso / Nota máxima) não é prova detalhada.
    if (m.some(row => row && row.slice(0, 4).some(v => norm(v) === 'PESO'))) return null;
    const rMax = m.findIndex(row => row && row.slice(0, 4).some(v => typeof v === 'string' && ehMax(v)) && row.some(v => typeof num(v) === 'number' && !(typeof v === 'string' && ehMax(v))));
    if (rMax < 1) return null;
    let rCab = -1;
    for (let r = rMax - 1; r >= Math.max(0, rMax - 4); r--) {
      const n = (m[r] || []).map(norm);
      if (n.some(x => x.startsWith('MATR')) && n.some(x => x.includes('NOME') || x === 'ALUNO')) { rCab = r; break; }
    }
    if (rCab < 0) return null;
    const cab = m[rCab] || [], sub = rMax - 1 > rCab ? (m[rMax - 1] || []) : [], maxs = m[rMax];
    const ncol = Math.max(cab.length, sub.length, maxs.length);
    const rot = c => txt(sub[c]) || txt(cab[c]);
    const col = { mat: -1, nome: -1, email: -1, modelo: -1, situacao: -1, nota: -1, num: -1 };
    for (let c = 0; c < ncol; c++) {
      const h = norm(cab[c]) || norm(sub[c]);
      if (col.mat < 0 && h.startsWith('MATR')) col.mat = c;
      else if (col.nome < 0 && (h.includes('NOME') || h === 'ALUNO')) col.nome = c;
      else if (col.email < 0 && h.includes('MAIL')) col.email = c;
      else if (col.modelo < 0 && /^(MODELO|VERSAO|TIPO DE PROVA|PROVA)$/.test(h)) col.modelo = c;
      else if (col.situacao < 0 && /^(SITUA|PRESEN)/.test(h)) col.situacao = c;
      else if (col.num < 0 && /^(N|NO|N[º°O]|NUM|NUMERO)\b/.test(h) && typeof num(maxs[c]) !== 'number') col.num = c;
    }
    const usadas = new Set(Object.values(col).filter(c => c >= 0));
    let nomeProva = '';
    const questoes = [], extras = [];
    const colItem = [], colExtra = [];
    let atual = null;
    for (let c = 0; c < ncol; c++) {
      if (usadas.has(c)) continue;
      const topo = txt(cab[c]), r = rot(c), mx = num(maxs[c]);
      if (ehNota(topo) || ehNota(txt(sub[c]))) {          // "NOTA P1": total da prova (calculado)
        col.nota = c;
        nomeProva = (ehNota(topo) ? topo : txt(sub[c])).replace(/^nota\s*(da|de|do)?\s*/i, '').trim();
        atual = null;
        continue;
      }
      if (typeof mx === 'number' && mx > 0) {
        if (topo && sub.length && (!atual || topo !== atual.rotulo)) {   // começo de uma questão (célula mesclada no topo)
          const sq = separarQuestao(topo);
          atual = { nome: sq.nome, titulo: sq.titulo, rotulo: topo, itens: [] };
          questoes.push(atual);
        }
        if (ehTotal(txt(sub[c]))) continue;                // total da questão: recalculado
        if (!atual) { atual = { nome: r, titulo: '', rotulo: topo, itens: [] }; questoes.push(atual); }
        const it = { id: uid('i'), nome: txt(sub[c]) || topo || 'item', max: mx };
        atual.itens.push(it);
        colItem.push({ c, it });
        if (!sub.length) atual = null;                     // sem 2ª linha de cabeçalho: cada coluna é uma questão
        continue;
      }
      if (r && !ehTotal(r)) { extras.push(r); colExtra.push({ c, nome: r }); }
    }
    questoes.forEach(q => { delete q.rotulo; });
    const qs = questoes.filter(q => q.itens.length);
    if (!qs.length) return null;
    const linhas = [];
    let rodape = '';
    for (let r = rMax + 1; r < m.length; r++) {
      const row = m[r] || [];
      const mat = col.mat >= 0 ? txt(row[col.mat]) : '', nome = col.nome >= 0 ? txt(row[col.nome]) : '';
      if (!mat && !nome) {
        const t0 = row.find(v => typeof v === 'string' && v.trim().length > 30);
        if (t0 && !rodape) rodape = t0.trim();
        continue;
      }
      const l = {
        matricula: mat.replace(/\s+/g, ''),
        nome, email: col.email >= 0 ? txt(row[col.email]) : '',
        modelo: col.modelo >= 0 ? txt(row[col.modelo]) : '',
        situacao: col.situacao >= 0 && /AUSENT|FALT/.test(norm(row[col.situacao])) ? 'Ausente' : 'Presente',
        itens: {}, extras: {}, textos: {},
        notaPlanilha: col.nota >= 0 ? num(row[col.nota]) : null
      };
      colItem.forEach(({ c, it }) => { const v = num(row[c]); if (typeof v === 'number') l.itens[it.id] = v; });
      colExtra.forEach(({ c, nome: n }) => { const v = txt(row[c]); if (v) l.extras[n] = v; });
      linhas.push(l);
    }
    const titulo = txt((m[0] || []).find(v => typeof v === 'string' && v.trim()));
    if (!nomeProva) nomeProva = (titulo.match(/^([A-Z]{1,3}\d{0,2})\s*[—–-]/) || [])[1] || '';
    return { nome: nomeProva, titulo, rodape, questoes: qs, extras, linhas };
  }

  /** Aba de critério: Questão | Subitem | Descrição | Valor | Regra. */
  function lerAbaCriterio(m, prova) {
    const rCab = m.findIndex(row => row && row.some(v => /^SUBITEM|^ITEM$/.test(norm(v))) && row.some(v => /^DESCRI/.test(norm(v))));
    if (rCab < 0) return false;
    const cab = m[rCab].map(norm);
    const ci = re => cab.findIndex(h => re.test(h));
    const cQ = ci(/^QUEST/), cS = ci(/^SUBITEM|^ITEM$/), cD = ci(/^DESCRI/), cR = ci(/^REGRA|^CRITERIO|^PONTUA/);
    const nota = m.slice(0, rCab).map(row => (row || []).find(v => typeof v === 'string' && v.trim().length > 30)).filter(Boolean);
    if (nota.length) prova.criterioNota = txt(nota[nota.length - 1]);
    for (let r = rCab + 1; r < m.length; r++) {
      const row = m[r] || [];
      const qn = cQ >= 0 ? txt(row[cQ]) : '', sn = cS >= 0 ? txt(row[cS]) : '';
      if (!qn && !sn) continue;
      const q = prova.questoes.find(x => norm(x.nome) === norm(qn)) || prova.questoes.find(x => x.itens.some(it => norm(it.nome) === norm(sn)));
      if (!q) continue;
      const it = q.itens.find(x => norm(x.nome) === norm(sn));
      const alvo = it || q;                                 // subitem "—": vale para a questão
      if (cD >= 0 && txt(row[cD])) alvo.descricao = txt(row[cD]);
      if (cR >= 0 && txt(row[cR])) alvo.regra = txt(row[cR]);
    }
    return true;
  }

  /** Aba de justificativas: Aluno (ou matrícula) e uma coluna por questão, mais observações. */
  function lerAbaJustificativas(m, prova) {
    const nomesQ = prova.questoes.map(q => norm(q.nome));
    const rCab = m.findIndex(row => row && row.some(v => /^(ALUNO|NOME)/.test(norm(v))) && row.some(v => nomesQ.includes(norm(v))));
    if (rCab < 0) return false;
    const cab = m[rCab].map(txt);
    const cA = cab.findIndex(h => /^(ALUNO|NOME)/.test(norm(h))), cM = cab.findIndex(h => norm(h).startsWith('MATR'));
    const cols = [];
    cab.forEach((h, c) => {
      if (!h || c === cA || c === cM || /^(N|NO|N[º°O]|MODELO|VERSAO|E-?MAIL)$/.test(norm(h))) return;
      const q = prova.questoes.find(x => norm(x.nome) === norm(h));
      cols.push({ c, chave: q ? q.nome : h });
    });
    prova.textos = cols.map(x => x.chave);
    for (let r = rCab + 1; r < m.length; r++) {
      const row = m[r] || [];
      const nome = txt(row[cA]), mat = cM >= 0 ? txt(row[cM]) : '';
      if (!nome && !mat) continue;
      const l = prova.linhas.find(x => (mat && x.matricula === mat) || (nome && norm(x.nome) === norm(nome)));
      const textos = {};
      cols.forEach(({ c, chave }) => { const v = txt(row[c]); if (v) textos[chave] = v; });
      if (l) Object.assign(l.textos, textos);
      else prova.linhas.push({ matricula: mat, nome, email: '', modelo: '', situacao: 'Presente', itens: {}, extras: {}, textos, soTexto: true });
    }
    return true;
  }

  /**
   * Provas detalhadas de uma planilha: [{ nome, titulo, rodape, criterioNota, questoes, extras, textos, linhas }].
   * Abas exportadas pelo app ("P1 detalhe", "P1 critério", "P1 justificativas") ou planilha de correção
   * com abas "Notas", "Critério" e "Justificativas".
   */
  function lerProvasDetalhadas(XLSX, wb) {
    const provas = [];
    const usadas = new Set();
    wb.SheetNames.forEach(nome => {
      const m = CC.sheetMatrix(XLSX, wb.Sheets[nome]);
      const p = lerAbaNotas(m);
      if (!p) return;
      const pref = (nome.match(/^(.*?)\s*detalhe$/i) || [])[1];
      p.prefixo = pref != null ? pref.trim() : '';
      if (!p.nome) p.nome = p.prefixo || 'Prova';
      usadas.add(nome);
      provas.push(p);
    });
    provas.forEach(p => {
      const da = n => !usadas.has(n) && (provas.length === 1 || (p.prefixo && norm(n).startsWith(norm(p.prefixo) + ' ')));
      wb.SheetNames.filter(da).forEach(nome => {
        const m = CC.sheetMatrix(XLSX, wb.Sheets[nome]);
        if (lerAbaCriterio(m, p) || lerAbaJustificativas(m, p)) usadas.add(nome);
      });
      p.textos = p.textos || [];
      delete p.prefixo;
    });
    return provas;
  }

  /**
   * Põe a prova lida na avaliação: casa os alunos (matrícula, e-mail, nome) e recalcula as notas.
   * o.substituir: troca o detalhe e as notas existentes. Devolve { casados, semAluno: [nomes], divergentes: [] }.
   */
  function aplicarProvaDetalhada(t, v, prova, o) {
    o = o || {};
    const det = (!o.substituir && v.detalhe) || { alunos: {} };
    // Mesma questão e subitem de antes: mantém o id (as notas já lançadas continuam valendo).
    if (det.questoes) prova.questoes.forEach(q => {
      const qv = det.questoes.find(x => norm(x.nome) === norm(q.nome));
      if (!qv) return;
      q.itens.forEach(it => {
        const iv = qv.itens.find(x => norm(x.nome) === norm(it.nome));
        if (!iv) return;
        prova.linhas.forEach(l => { if (it.id in l.itens) { l.itens[iv.id] = l.itens[it.id]; delete l.itens[it.id]; } });
        it.id = iv.id;
      });
    });
    Object.assign(det, {
      titulo: prova.titulo || '', rodape: prova.rodape || '', criterioNota: prova.criterioNota || '',
      questoes: prova.questoes, extras: prova.extras || [], textos: prova.textos || []
    });
    if (o.substituir) det.alunos = {};
    const res = { casados: 0, semAluno: [], divergentes: [] };
    prova.linhas.forEach(l => {
      const a = CC.findAluno(t, { matricula: l.matricula, nome: l.nome, email: l.email }, false);
      if (!a) { res.semAluno.push(l.nome || l.matricula); return; }
      const atual = det.alunos[a.id] || {};
      det.alunos[a.id] = {
        situacao: l.soTexto ? (atual.situacao || 'Presente') : l.situacao, modelo: l.modelo || atual.modelo || '',
        itens: l.soTexto ? (atual.itens || {}) : l.itens, extras: Object.assign({}, atual.extras, l.extras),
        textos: Object.assign({}, atual.textos, l.textos)
      };
      res.casados++;
    });
    v.detalhe = det;
    sincronizarNotasDetalhe(t, v);
    prova.linhas.forEach(l => {
      const a = CC.findAluno(t, { matricula: l.matricula, nome: l.nome, email: l.email }, false);
      if (a && typeof l.notaPlanilha === 'number' && Math.abs(l.notaPlanilha - (totalAluno(det, a.id) || 0)) > 0.011) {
        res.divergentes.push(`${l.nome}: planilha ${numBR(l.notaPlanilha, 2)}, soma ${numBR(totalAluno(det, a.id) || 0, 2)}`);
      }
    });
    return res;
  }

  /* ---------- estrutura em texto (para criar/editar no app) ---------- */

  /** "Q1 — Fundamentos: 1a = 0,6; 1b = 0,5" — uma questão por linha. */
  function estruturaParaTexto(det) {
    const v = x => String(x).replace('.', ',');
    return (det ? det.questoes : []).map(q => (q.nome + (q.titulo ? ' — ' + q.titulo : '')) + ': ' +
      (q.itens.length === 1 && q.itens[0].nome === q.nome ? v(q.itens[0].max)          // "Q3: 2" (questão sem subitens)
        : q.itens.map(it => it.nome + ' = ' + v(it.max)).join('; '))).join('\n');
  }

  /** Lê o texto da estrutura, aproveitando os ids dos subitens que já existiam (para não perder notas). */
  function textoParaEstrutura(texto, antigo) {
    const velhos = antigo ? antigo.questoes : [];
    const questoes = [], erros = [];
    String(texto || '').split(/\r?\n/).forEach(l => {
      if (!l.trim()) return;
      const m = l.match(/^(.+?):\s*(.+)$/);
      const cabeca = m ? m[1] : l.split('=')[0], corpo = m ? m[2] : l;
      const sq = separarQuestao(cabeca.trim());
      const qv = velhos.find(x => norm(x.nome) === norm(sq.nome));
      const itens = [];
      corpo.split(';').forEach(p => {
        const mi = p.match(/^\s*(.*?)\s*=\s*([\d.,]+)\s*$/);
        if (!mi) { if (p.trim()) erros.push(l.trim()); return; }
        const nome = mi[1] || sq.nome, max = num(mi[2]);
        const iv = qv && qv.itens.find(x => norm(x.nome) === norm(nome));
        itens.push(Object.assign({}, iv || {}, { id: iv ? iv.id : uid('i'), nome, max }));
      });
      if (itens.length) questoes.push(Object.assign({}, qv || {}, { nome: sq.nome, titulo: sq.titulo, itens }));
    });
    return { questoes, erros };
  }

  /* ---------- estatísticas ---------- */

  function estatisticasProva(t, v) {
    const det = v.detalhe;
    const ids = Object.keys(det.alunos).filter(id => t.alunos.some(a => a.id === id));
    const presentes = ids.filter(id => det.alunos[id].situacao !== 'Ausente' && totalAluno(det, id) != null);
    const resumo = vals => vals.length ? { media: r2(vals.reduce((s, x) => s + x, 0) / vals.length), maior: Math.max(...vals), menor: Math.min(...vals), zeros: vals.filter(x => x === 0).length } : null;
    const questoes = det.questoes.map(q => {
      const vals = presentes.map(id => totalQuestao(det, id, q)).filter(x => x != null);
      return Object.assign({ q, max: maxQuestao(q) }, resumo(vals));
    });
    const itens = itensDe(det).map(it => {
      const vals = presentes.map(id => det.alunos[id].itens[it.id]).filter(x => typeof x === 'number');
      return Object.assign({ it, max: it.max }, resumo(vals));
    });
    const modelos = {};
    presentes.forEach(id => {
      const k = det.alunos[id].modelo || '—';
      (modelos[k] = modelos[k] || []).push(totalAluno(det, id));
    });
    return {
      inscritos: ids.length, presentes: presentes.length, ausentes: ids.filter(id => det.alunos[id].situacao === 'Ausente').length,
      geral: resumo(presentes.map(id => totalAluno(det, id))), max: maxDetalhe(det), questoes, itens,
      modelos: Object.keys(modelos).sort().map(k => ({ modelo: k, n: modelos[k].length, media: r2(modelos[k].reduce((s, x) => s + x, 0) / modelos[k].length) }))
    };
  }

  /* ---------- exportação: abas da prova ---------- */

  /** Acrescenta, para cada avaliação com detalhe, as abas "<nome> detalhe", "<nome> critério" e "<nome> justificativas". */
  function abasProvas(XLSX, wb, t, alunos) {
    const U = XLSX.utils;
    const { estilo, ST, corpo, COR, sheetName } = CC._xl;
    const put = (ws, r, c, cell) => { ws[U.encode_cell({ r, c })] = cell; };
    const s = (v, st) => ({ t: 's', v: String(v == null ? '' : v), s: st });
    const n = (v, st, extra) => Object.assign({ t: 'n', v, s: st }, extra);
    const A = (r, c) => U.encode_cell({ r, c });
    const col = c => U.encode_col(c);
    const nomes = new Set(wb.SheetNames);
    const nomeAba = base => { let x = sheetName(base); for (let k = 2; nomes.has(x); k++) x = sheetName(base.slice(0, 27) + ' ' + k); nomes.add(x); return x; };

    t.avaliacoes.filter(v => v.detalhe && v.detalhe.questoes && v.detalhe.questoes.length).forEach(v => {
      const det = v.detalhe;
      const lista = alunos.filter(a => det.alunos[a.id] || a.ativo);
      const abaNotas = nomeAba(v.nome + ' detalhe');
      // ---- notas por subitem
      const ws = {};
      put(ws, 0, 0, s(det.titulo || v.nome + ' — ' + CC.nomeTurma(t) + (t.periodo ? ' — ' + CC.periodoCurto(t.periodo) : ''), ST.titulo()));
      put(ws, 1, 0, s('Notas por subitem. Totais por questão e nota final são fórmulas. Situação "Ausente" = sem nota. Critério e justificativas nas abas seguintes.', ST.subtitulo()));
      const H = 3, R1 = H + 1, RM = H + 2, D0 = H + 3;
      const fixas = ['Matrícula', 'Nome', 'E-mail', 'Modelo', 'Situação'];
      fixas.forEach((h, c) => { put(ws, H, c, s(h, c === 1 ? ST.cabEsq() : ST.cab())); put(ws, R1, c, s('', ST.cab())); });
      put(ws, RM, 1, s('Valor máximo', ST.rotulo()));
      [0, 2, 3, 4].forEach(c => put(ws, RM, c, s('', ST.rotulo())));
      let c = fixas.length;
      const grupos = [];
      det.questoes.forEach((q, qi) => {
        const ini = c;
        const fill = qi % 2 ? COR.primaria : '2E75B6';
        q.itens.forEach((it, k) => {
          put(ws, H, c, s(k === 0 ? q.nome + (q.titulo ? ' — ' + q.titulo : '') : '', ST.cab(fill)));
          put(ws, R1, c, s(it.nome, ST.cab(fill)));
          put(ws, RM, c, n(it.max, ST.rotulo()));
          c++;
        });
        put(ws, H, c, s(q.itens.length ? '' : q.nome, ST.cab(fill)));
        put(ws, R1, c, s('Total', ST.cab(fill)));
        put(ws, RM, c, n(maxQuestao(q), ST.rotulo(), { f: 'SUM(' + A(RM, ini) + ':' + A(RM, c - 1) + ')' }));
        grupos.push({ q, ini, fim: c - 1, tot: c });
        c++;
      });
      const cNota = c;
      put(ws, H, cNota, s('NOTA ' + v.nome, ST.cab(COR.A[1])));
      put(ws, R1, cNota, s('', ST.cab(COR.A[1])));
      put(ws, RM, cNota, n(maxDetalhe(det), ST.rotulo(), { f: grupos.map(gr => A(RM, gr.tot)).join('+') || '0' }));
      const extras = det.extras || [];
      extras.forEach((e, k) => { put(ws, H, cNota + 1 + k, s(e, ST.cab())); put(ws, R1, cNota + 1 + k, s('', ST.cab())); put(ws, RM, cNota + 1 + k, s('', ST.rotulo())); });
      lista.forEach((a, i) => {
        const r = D0 + i, d = det.alunos[a.id] || { situacao: '', itens: {}, extras: {} }, inat = !a.ativo;
        const cSit = A(r, 4).replace(/\d+$/, '');
        put(ws, r, 0, s(a.matricula, corpo(i, inat, { alignment: { horizontal: 'center' } })));
        put(ws, r, 1, s(a.nome, corpo(i, inat)));
        put(ws, r, 2, s(a.email || '', corpo(i, inat, { font: { sz: 9 } })));
        put(ws, r, 3, s(d.modelo || '', corpo(i, inat, { alignment: { horizontal: 'center' } })));
        put(ws, r, 4, s(d.situacao || '', corpo(i, inat, { alignment: { horizontal: 'center' } })));
        grupos.forEach(gr => {
          gr.q.itens.forEach((it, k) => {
            const x = d.itens[it.id];
            put(ws, r, gr.ini + k, typeof x === 'number' ? n(x, corpo(i, inat, { numFmt: '0.00', alignment: { horizontal: 'center' } }), { z: '0.00' }) : s('', corpo(i, inat)));
          });
          const tq = totalQuestao(det, a.id, gr.q);
          put(ws, r, gr.tot, Object.assign(tq == null ? { t: 's', v: '' } : { t: 'n', v: tq, z: '0.00' }, {
            s: corpo(i, inat, { font: { bold: true }, numFmt: '0.00', alignment: { horizontal: 'center' } }),
            f: 'IF($' + cSit + (r + 1) + '="Ausente","",SUM(' + A(r, gr.ini) + ':' + A(r, gr.fim) + '))'
          }));
        });
        const tot = det.alunos[a.id] ? totalAluno(det, a.id) : null;
        put(ws, r, cNota, Object.assign(tot == null ? { t: 's', v: '' } : { t: 'n', v: tot, z: '0.00' }, {
          s: corpo(i, inat, { font: { bold: true, color: { rgb: COR.A[1] } }, numFmt: '0.00', alignment: { horizontal: 'center' } }),
          f: 'IF($' + cSit + (r + 1) + '="Ausente","",' + (grupos.map(gr => 'N(' + A(r, gr.tot) + ')').join('+') || '0') + ')'
        }));
        extras.forEach((e, k) => put(ws, r, cNota + 1 + k, s((d.extras || {})[e] || '', corpo(i, inat, { font: { sz: 9 } }))));
      });
      const rUlt = D0 + lista.length - 1;
      if (det.rodape) put(ws, rUlt + 2, 0, s(det.rodape, ST.subtitulo()));
      ws['!ref'] = U.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(rUlt + 2, RM), c: cNota + extras.length } });
      ws['!cols'] = [{ wch: 11 }, { wch: 40 }, { wch: 24 }, { wch: 8 }, { wch: 10 }]
        .concat(Array.from({ length: cNota - fixas.length }, () => ({ wch: 8 }))).concat([{ wch: 9 }]).concat(extras.map(() => ({ wch: 18 })));
      ws['!rows'] = [{ hpt: 24 }, { hpt: 16 }, { hpt: 6 }, { hpt: 32 }, { hpt: 28 }];
      U.book_append_sheet(wb, ws, abaNotas);

      // ---- estatísticas da prova (fórmulas sobre a aba de notas)
      const ref = (cc, r0, r1) => "'" + abaNotas + "'!$" + col(cc) + '$' + (r0 + 1) + ':$' + col(cc) + '$' + (r1 + 1);
      const es = {};
      put(es, 0, 0, s('Estatísticas — ' + v.nome, ST.titulo()));
      put(es, 1, 0, s('Calculadas sobre a aba "' + abaNotas + '" (só quem tem nota).', ST.subtitulo()));
      let r = 3;
      ['Questão', 'Valor', 'Média', 'Média (% do valor)', 'Maior', 'Menor', 'Nº de zeros'].forEach((h, k) => put(es, r, k, s(h, k ? ST.cab() : ST.cabEsq())));
      const linhaEst = (rotulo, cc, maxCell, i) => {
        r++;
        const rg = lista.length ? ref(cc, D0, rUlt) : null;
        const sem = '"—"';
        put(es, r, 0, s(rotulo, corpo(i, false)));
        put(es, r, 1, n(0, corpo(i, false, { numFmt: '0.00' }), { f: "'" + abaNotas + "'!" + maxCell, z: '0.00' }));
        put(es, r, 2, n(0, corpo(i, false, { numFmt: '0.00' }), { f: rg ? 'IF(COUNT(' + rg + ')=0,' + sem + ',AVERAGE(' + rg + '))' : sem, z: '0.00' }));
        put(es, r, 3, n(0, corpo(i, false, { numFmt: '0%' }), { f: 'IF(ISNUMBER(C' + (r + 1) + '),C' + (r + 1) + '/B' + (r + 1) + ',' + sem + ')', z: '0%' }));
        put(es, r, 4, n(0, corpo(i, false, { numFmt: '0.00' }), { f: rg ? 'IF(COUNT(' + rg + ')=0,' + sem + ',MAX(' + rg + '))' : sem, z: '0.00' }));
        put(es, r, 5, n(0, corpo(i, false, { numFmt: '0.00' }), { f: rg ? 'IF(COUNT(' + rg + ')=0,' + sem + ',MIN(' + rg + '))' : sem, z: '0.00' }));
        put(es, r, 6, n(0, corpo(i, false), { f: rg ? 'COUNTIF(' + rg + ',0)' : '0' }));
      };
      grupos.forEach((gr, i) => linhaEst(gr.q.nome + (gr.q.titulo ? ' — ' + gr.q.titulo : ''), gr.tot, A(RM, gr.tot), i));
      linhaEst('Nota ' + v.nome, cNota, A(RM, cNota), grupos.length);
      r += 2;
      put(es, r, 0, s('Subitem', ST.cabEsq()));
      ['Valor', 'Média', 'Média (% do valor)'].forEach((h, k) => put(es, r, k + 1, s(h, ST.cab())));
      let i2 = 0;
      grupos.forEach(gr => gr.q.itens.forEach((it, k) => {
        r++;
        const cc = gr.ini + k, rg = lista.length ? ref(cc, D0, rUlt) : null;
        put(es, r, 0, s(gr.q.nome + ' · ' + it.nome, corpo(i2, false)));
        put(es, r, 1, n(it.max, corpo(i2, false, { numFmt: '0.00' }), { f: "'" + abaNotas + "'!" + A(RM, cc), z: '0.00' }));
        put(es, r, 2, n(0, corpo(i2, false, { numFmt: '0.00' }), { f: rg ? 'IF(COUNT(' + rg + ')=0,"—",AVERAGE(' + rg + '))' : '"—"', z: '0.00' }));
        put(es, r, 3, n(0, corpo(i2, false, { numFmt: '0%' }), { f: 'IF(ISNUMBER(C' + (r + 1) + '),C' + (r + 1) + '/B' + (r + 1) + ',"—")', z: '0%' }));
        i2++;
      }));
      const mods = Array.from(new Set(Object.values(det.alunos).map(d => d.modelo).filter(Boolean))).sort();
      if (mods.length > 1 && lista.length) {
        r += 2;
        ['Modelo', 'Alunos', 'Média'].forEach((h, k) => put(es, r, k, s(h, k ? ST.cab() : ST.cabEsq())));
        mods.forEach((md, k) => {
          r++;
          put(es, r, 0, s(md, corpo(k, false)));
          put(es, r, 1, n(0, corpo(k, false), { f: 'COUNTIFS(' + ref(3, D0, rUlt) + ',A' + (r + 1) + ',' + ref(cNota, D0, rUlt) + ',">=0")' }));
          put(es, r, 2, n(0, corpo(k, false, { numFmt: '0.00' }), { f: 'IF(B' + (r + 1) + '=0,"—",AVERAGEIFS(' + ref(cNota, D0, rUlt) + ',' + ref(3, D0, rUlt) + ',A' + (r + 1) + '))', z: '0.00' }));
        });
      }
      es['!ref'] = U.encode_range({ s: { r: 0, c: 0 }, e: { r, c: 6 } });
      es['!cols'] = [{ wch: 36 }, { wch: 9 }, { wch: 9 }, { wch: 12 }, { wch: 9 }, { wch: 9 }, { wch: 11 }];
      es['!rows'] = [{ hpt: 24 }];
      U.book_append_sheet(wb, es, nomeAba(v.nome + ' estatísticas'));

      // ---- critério
      const cr = {};
      put(cr, 0, 0, s('Critério de correção — ' + v.nome, ST.titulo()));
      put(cr, 1, 0, s(det.criterioNota || 'Valor de cada subitem e regra de pontuação.', ST.subtitulo()));
      ['Questão', 'Subitem', 'Descrição', 'Valor', 'Regra de pontuação'].forEach((h, k) => put(cr, 3, k, s(h, k === 2 || k === 4 ? ST.cabEsq() : ST.cab())));
      let rc = 3, ic = 0;
      const wrap = { alignment: { wrapText: true, vertical: 'top' } };
      det.questoes.forEach(q => {
        if (q.descricao || q.regra) {
          rc++;
          put(cr, rc, 0, s(q.nome, corpo(ic, false, { font: { bold: true } }))); put(cr, rc, 1, s('—', corpo(ic, false)));
          put(cr, rc, 2, s(q.descricao || q.titulo || '', corpo(ic, false, wrap))); put(cr, rc, 3, n(maxQuestao(q), corpo(ic, false)));
          put(cr, rc, 4, s(q.regra || '', corpo(ic, false, wrap))); ic++;
        }
        q.itens.forEach(it => {
          rc++;
          put(cr, rc, 0, s(q.nome, corpo(ic, false))); put(cr, rc, 1, s(it.nome, corpo(ic, false)));
          put(cr, rc, 2, s(it.descricao || '', corpo(ic, false, wrap))); put(cr, rc, 3, n(it.max, corpo(ic, false)));
          put(cr, rc, 4, s(it.regra || '', corpo(ic, false, wrap))); ic++;
        });
      });
      cr['!ref'] = U.encode_range({ s: { r: 0, c: 0 }, e: { r: rc, c: 4 } });
      cr['!cols'] = [{ wch: 9 }, { wch: 16 }, { wch: 50 }, { wch: 8 }, { wch: 70 }];
      cr['!rows'] = [{ hpt: 24 }];
      U.book_append_sheet(wb, cr, nomeAba(v.nome + ' critério'));

      // ---- justificativas
      const textos = (det.textos && det.textos.length ? det.textos : det.questoes.map(q => q.nome).concat('Observações'));
      const comTexto = lista.filter(a => det.alunos[a.id] && Object.keys(det.alunos[a.id].textos || {}).length);
      if (comTexto.length) {
        const ju = {};
        put(ju, 0, 0, s('Justificativas da correção — ' + v.nome, ST.titulo()));
        ['Matrícula', 'Aluno', 'Modelo'].concat(textos).forEach((h, k) => put(ju, 2, k, s(h, k === 1 ? ST.cabEsq() : ST.cab())));
        comTexto.forEach((a, i) => {
          const d = det.alunos[a.id], rr = 3 + i;
          put(ju, rr, 0, s(a.matricula, corpo(i, false, { alignment: { horizontal: 'center', vertical: 'top' } })));
          put(ju, rr, 1, s(a.nome, corpo(i, false, wrap)));
          put(ju, rr, 2, s(d.modelo || '', corpo(i, false, { alignment: { horizontal: 'center', vertical: 'top' } })));
          textos.forEach((k, j) => put(ju, rr, 3 + j, s(d.textos[k] || '', corpo(i, false, Object.assign({ font: { sz: 9 } }, wrap)))));
        });
        ju['!ref'] = U.encode_range({ s: { r: 0, c: 0 }, e: { r: 2 + comTexto.length, c: 2 + textos.length } });
        ju['!cols'] = [{ wch: 11 }, { wch: 28 }, { wch: 8 }].concat(textos.map(() => ({ wch: 60 })));
        ju['!rows'] = [{ hpt: 24 }];
        U.book_append_sheet(wb, ju, nomeAba(v.nome + ' justificativas'));
      }
    });
  }

  Object.assign(CC, {
    itensDe, maxDetalhe, maxQuestao, totalQuestao, totalAluno, sincronizarNotasDetalhe, lerProvasDetalhadas,
    aplicarProvaDetalhada, estruturaParaTexto, textoParaEstrutura, estatisticasProva, abasProvas
  });
})(typeof window !== 'undefined' ? window : globalThis);
