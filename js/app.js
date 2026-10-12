/* ClassroomControl — interface. Rotas por hash:
 *   #/                         turmas
 *   #/t/{id}/chamada[/{aula}]  chamada
 *   #/t/{id}/alunos            alunos
 *   #/t/{id}/aluno/{aluno}     histórico de um aluno
 *   #/t/{id}/cronograma        aulas
 *   #/t/{id}/notas[/{aval}]    notas
 *   #/t/{id}/resumo            faltas, médias, situação
 */
(function () {
  'use strict';
  const CC = window.CC;
  const VERSAO = '0.3.0';
  const KEY = 'classroomcontrol.v1';
  const $ = sel => document.querySelector(sel);
  const app = $('#app');

  /* ---------- armazenamento ---------- */

  let db = carregar();
  let salvarTimer = null;

  function carregar() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const dados = JSON.parse(raw);
        dados.turmas.forEach(t => { t.config = Object.assign({}, CC.DEFAULT_CONFIG, t.config); delete t.config.totalAulas; });
        return dados;
      }
    } catch (e) { console.error(e); }
    return { versao: 1, turmas: [] };
  }

  function salvar() {
    clearTimeout(salvarTimer);
    salvarTimer = setTimeout(() => {
      try { localStorage.setItem(KEY, JSON.stringify(db)); }
      catch (e) { toast('Não consegui salvar no aparelho: ' + e.message); }
    }, 150);
  }

  window.addEventListener('pagehide', () => {
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* sem espaço */ }
  });

  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  function turma(id) { return db.turmas.find(t => t.id === id); }

  /** Tabela código → curso: a editada pelo usuário ou, se não houver, a da UFF (cursos-uff.js). */
  function cursos() { return db.cursos || window.CURSOS_UFF || {}; }

  function limTxt(t) {
    const l = CC.limiteFaltas(t);
    return CC.numBR(l, l % 1 ? 1 : 0);
  }

  function cursoDe(a) {
    const i = CC.infoMatricula(a.matricula, cursos());
    return i ? i.curso : '';
  }

  /* ---------- utilitários de UI ---------- */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function nomeCurto(nome) {
    return CC.titleCase(nome || '');
  }

  let toastTimer = null;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  /** Abre o diálogo; resolve com o botão clicado (value) e os campos do formulário. */
  /** Fecha o diálogo aberto e espera o evento "close" (que é assíncrono), para ele não
   *  ser confundido com o fechamento do próximo diálogo. */
  function fecharDialogo() {
    const dlg = $('#dlg');
    if (!dlg.open) return Promise.resolve();
    return new Promise(ok => { dlg.addEventListener('close', () => ok(), { once: true }); dlg.close(); });
  }

  async function dialogo(html, aoAbrir) {
    await fecharDialogo();
    const dlg = $('#dlg'), form = $('#dlg-form');
    form.innerHTML = html;
    return new Promise(resolve => {
      const fechar = () => {
        dlg.removeEventListener('close', fechar);
        const dados = {};
        new FormData(form).forEach((v, k) => {
          if (k in dados) dados[k] = [].concat(dados[k], v); else dados[k] = v;
        });
        resolve({ acao: dlg.returnValue, dados, form });
      };
      dlg.addEventListener('close', fechar);
      dlg.returnValue = '';
      dlg.showModal();
      if (aoAbrir) aoAbrir(form);
      const foco = form.querySelector('[autofocus]');
      if (foco) foco.focus();
    });
  }

  function confirmar(titulo, texto, botao, perigo) {
    return dialogo(`<h2>${esc(titulo)}</h2><p>${texto}</p>
      <div class="acoes"><button class="btn" value="">Cancelar</button>
      <button class="btn ${perigo ? 'danger' : 'primary'}" value="ok">${esc(botao || 'OK')}</button></div>`)
      .then(r => r.acao === 'ok');
  }

  /**
   * Escolhe um arquivo para importar. Com pasta de trabalho, mostra antes os arquivos dela
   * (do mais recente ao mais antigo); "Outro arquivo…" abre o seletor do sistema.
   */
  async function escolherArquivo(accept, varios, t) {
    const exts = accept.split(',').map(x => x.trim().toLowerCase()).filter(x => x.startsWith('.'));
    if (!varios && exts.length && Pasta.suportada) {
      const pasta = await Pasta.da(t);
      if (pasta) {
        let arqs = [];
        try { arqs = await Pasta.listar(pasta.handle, exts); } catch (e) { /* pasta indisponível */ }
        const r = await dialogo(`<h2>Abrir de “${esc(pasta.handle.name)}”</h2>
          ${arqs.length ? `<ul class="menu-list arquivos">${arqs.slice(0, 40).map((a, i) => `<li><button value="${i}">${esc(a.nome)}<span class="muted small">${new Date(a.data).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</span></button></li>`).join('')}</ul>`
            : `<p class="muted">Nenhum arquivo ${exts.join(' / ')} nesta pasta.</p>`}
          <div class="acoes"><button class="btn" value="">Cancelar</button><button class="btn" value="outro">Outro arquivo…</button></div>`);
        if (r.acao === '') return null;
        if (r.acao !== 'outro') return arqs[+r.acao].handle.getFile();
      }
    }
    return escolherDoSistema(accept, varios);
  }

  /** Abre o seletor de arquivos do sistema; com `varios`, devolve uma lista. */
  function escolherDoSistema(accept, varios) {
    const input = $('#file-input');
    input.value = '';
    input.accept = accept;
    input.multiple = !!varios;
    return new Promise(resolve => {
      input.onchange = () => resolve(varios ? Array.from(input.files) : (input.files[0] || null));
      input.click();
    });
  }

  function lerPlanilha(file) {
    return file.arrayBuffer().then(buf => {
      if (!window.XLSX) throw new Error('Biblioteca de planilhas não carregou (abra o app uma vez com internet).');
      const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
      return CC.parseWorkbook(XLSX, wb);
    });
  }

  /** Entrega um arquivo gerado: na pasta de trabalho, "salvar como", compartilhar ou baixar. */
  async function entregarArquivo(blob, nome, t) {
    const file = new File([blob], nome, { type: blob.type });
    const pasta = await Pasta.da(t);
    const podeCompartilhar = !!(navigator.canShare && navigator.canShare({ files: [file] }));
    const opcoes = [];
    if (pasta) opcoes.push(['pasta', `Salvar em “${pasta.handle.name}”`]);
    if (Pasta.suportaSalvarComo) opcoes.push(['salvarcomo', 'Salvar como… (escolher o local)']);
    if (podeCompartilhar) opcoes.push(['compartilhar', 'Compartilhar… (Drive, e-mail…)']);
    opcoes.push(['baixar', 'Baixar (pasta Downloads)']);
    const r = await dialogo(`<h2>Arquivo pronto</h2><p class="muted">${esc(nome)}</p>
      <div class="stack">${opcoes.map((o, i) => `<button class="btn block ${i ? '' : 'primary'}" value="${o[0]}">${esc(o[1])}</button>`).join('')}</div>
      ${!pasta && Pasta.suportada ? '<p class="muted small" style="margin-top:12px">Dica: escolha uma pasta de trabalho (menu ⋮) para salvar direto nela.</p>' : ''}
      <div class="acoes"><button class="btn" value="">Cancelar</button></div>`);
    if (r.acao === 'pasta') {
      try {
        let destino = nome;
        if (await Pasta.existe(pasta.handle, nome)) {
          const comData = nome.replace(/(\.[a-z]+)$/i, '-' + CC.todayISO() + '$1');
          const q = await dialogo(`<h2>Arquivo já existe</h2><p><b>${esc(nome)}</b> já está em “${esc(pasta.handle.name)}”. Se você ajustou essa planilha no Excel, substituir apaga os ajustes.</p>
            <div class="acoes"><button class="btn" value="">Cancelar</button><button class="btn" value="data">Salvar como ${esc(comData)}</button><button class="btn danger" value="subst">Substituir</button></div>`);
          if (!q.acao) return;
          if (q.acao === 'data') destino = comData;
        }
        await Pasta.gravar(pasta.handle, destino, blob);
        return toast(`Salvo em ${pasta.handle.name}/${destino}`);
      } catch (e) { return toast('Não consegui gravar na pasta: ' + e.message); }
    }
    if (r.acao === 'salvarcomo') {
      try { const n = await Pasta.salvarComo(nome, blob, pasta && pasta.handle); return toast('Salvo: ' + n); }
      catch (e) { if (e.name !== 'AbortError') toast('Não consegui salvar: ' + e.message); return; }
    }
    if (r.acao === 'compartilhar') {
      try { await navigator.share({ files: [file], title: nome }); } catch (e) { /* cancelado */ }
      return;
    }
    if (r.acao !== 'baixar') return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = nome;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  /* ---------- roteamento ---------- */

  function go(hash) {
    if (location.hash === hash) render(); else location.hash = hash;
  }

  window.addEventListener('hashchange', () => {
    // Botão "voltar" do Android com um diálogo aberto: fecha o diálogo.
    const dlg = $('#dlg');
    if (dlg.open) dlg.close();
    render();
  });

  function setTopo(titulo, sub, voltar, menu) {
    $('#titulo').textContent = titulo;
    $('#subtitulo').textContent = sub || '';
    document.title = titulo === 'Chamada' ? 'Chamada' : titulo + ' · Chamada';
    $('#btn-voltar').hidden = !voltar;
    $('#btn-voltar').onclick = () => go(voltar);
    $('#btn-menu').hidden = !menu;
    $('#btn-menu').onclick = menu || null;
  }

  function setTabs(t, ativa) {
    const tabs = $('#tabs');
    if (!t) { tabs.hidden = true; return; }
    tabs.hidden = false;
    const itens = [['chamada', 'Chamada'], ['alunos', 'Alunos'], ['cronograma', 'Aulas'], ['notas', 'Notas'], ['resumo', 'Resumo']];
    tabs.innerHTML = itens.map(([k, l]) => `<a href="#/t/${t.id}/${k}" class="${k === ativa ? 'on' : ''}">${l}</a>`).join('');
  }

  function render() {
    const partes = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    window.scrollTo(0, 0);
    if (partes[0] !== 't') return telaTurmas();
    const t = turma(partes[1]);
    if (!t) return go('#/');
    const tela = partes[2] || 'chamada';
    const arg = partes[3];
    setTabs(t, tela === 'aluno' ? 'alunos' : tela);
    setTopo(t.codigo ? (t.codigo + (t.turma ? ' ' + t.turma : '')) : t.disciplina,
      (t.codigo ? t.disciplina : t.periodo) + (t.arquivada ? ' · arquivada' : ''), '#/', () => menuTurma(t));
    ({ chamada: telaChamada, alunos: telaAlunos, aluno: telaAluno, cronograma: telaCronograma, notas: telaNotas, resumo: telaResumo }[tela] || telaChamada)(t, arg);
  }

  /* ---------- tela: turmas ---------- */

  function telaTurmas() {
    setTabs(null);
    setTopo('Chamada', 'Suas turmas', null, menuGeral);
    if (!db.turmas.length) {
      app.innerHTML = `<div class="card empty">
        <p><strong>Nenhuma turma ainda.</strong></p>
        <p>Importe a lista de alunos exportada do sistema (.xls ou .xlsx) — ou uma planilha de chamada antiga — para criar a primeira turma.</p>
        <div class="stack"><button class="btn primary block" id="imp">Importar planilha</button>
        <button class="btn block" id="nova">Criar turma vazia</button>
        <button class="btn block" id="restaurar">Restaurar backup</button></div></div>`;
    } else {
      const cartao = t => {
        const ativos = t.alunos.filter(a => a.ativo).length;
        const dadas = t.aulas.filter(a => CC.aulaRealizada(t, a)).length;
        return `<a class="card turma-card ${t.arquivada ? 'arquivada' : ''}" href="#/t/${t.id}/chamada">
          <div><span class="codigo">${esc([t.codigo, t.turma].filter(Boolean).join(' '))}</span> <span class="muted">${esc(t.periodo)}</span></div>
          <h2>${esc(t.disciplina)}</h2>
          <div class="muted small">${ativos} alunos · ${dadas} de ${CC.aulasPrevistas(t)} aulas com chamada${t.arquivada ? ' · arquivada em ' + CC.fmtDate(t.arquivada) : ''}</div></a>`;
      };
      const ativas = db.turmas.filter(t => !t.arquivada), arquivadas = db.turmas.filter(t => t.arquivada);
      app.innerHTML = (ativas.length ? ativas.map(cartao).join('') : '<div class="card empty">Nenhuma turma ativa.</div>') +
        (arquivadas.length ? `<details class="arquivo"><summary>Turmas arquivadas (${arquivadas.length})</summary>${arquivadas.map(cartao).join('')}</details>` : '') +
        `<button class="fab" id="imp">+ Importar planilha</button>`;
    }
    const imp = $('#imp'); if (imp) imp.onclick = importarNovaTurma;
    const nova = $('#nova'); if (nova) nova.onclick = criarTurmaVazia;
    const rest = $('#restaurar'); if (rest) rest.onclick = restaurarBackup;
  }

  function menuGeral() {
    dialogo(`<h2>Menu</h2><ul class="menu-list">
      <li><button value="importar">Importar planilha (nova turma)</button></li>
      <li><button value="vazia">Criar turma vazia</button></li>
      <li class="sep"></li>
      <li><button value="pasta">Pasta de trabalho</button></li>
      <li><button value="cursos">Códigos de curso</button></li>
      <li><button value="backup">Salvar backup (todas as turmas)</button></li>
      <li><button value="restaurar">Restaurar backup</button></li>
      <li class="sep"></li>
      <li><button value="sobre">Sobre</button></li>
      </ul>`).then(r => {
      if (r.acao === 'cursos') editarCursos();
      if (r.acao === 'pasta') configurarPasta(null);
      if (r.acao === 'importar') importarNovaTurma();
      if (r.acao === 'vazia') criarTurmaVazia();
      if (r.acao === 'backup') salvarBackup();
      if (r.acao === 'restaurar') restaurarBackup();
      if (r.acao === 'sobre') sobre();
    });
  }

  function sobre() {
    dialogo(`<h2>Sobre</h2>
      <p class="muted small">Chamada · versão ${VERSAO}</p>
      <p>Os dados ficam só neste aparelho. Faça backups de vez em quando (Menu → Salvar backup) e exporte a planilha de cada turma ao fim do período.</p>
      <p class="muted small">Faltas = F + peso × A (atraso). J (justificada) não conta como falta.</p>
      <div class="acoes"><button class="btn primary" value="">Fechar</button></div>`);
  }

  async function criarTurmaVazia() {
    const r = await dialogo(`<h2>Nova turma</h2><div class="stack">
      <label class="field">Disciplina<input type="text" name="disciplina" required autofocus></label>
      <div class="row nowrap"><label class="field grow">Código<input type="text" name="codigo"></label>
      <label class="field grow">Turma<input type="text" name="turma"></label></div>
      <label class="field">Período<input type="text" name="periodo" placeholder="ex.: 20262"></label>
      ${camposPeriodo(CC.DEFAULT_CONFIG, true)}
      ${camposPlano(CC.planoPadrao(2, true, true))}</div>
      <div class="acoes"><button class="btn" value="" formnovalidate>Cancelar</button><button class="btn primary" value="ok">Criar</button></div>`, ligarPlano);
    if (r.acao !== 'ok') return;
    const t = CC.novaTurma(r.dados);
    aplicarPeriodo(t, lerPeriodo(r.dados), !!r.dados.gerar);
    CC.aplicarPlano(t, lerPlano(r.dados));
    db.turmas.push(t); salvar();
    go('#/t/' + t.id + '/alunos');
  }

  async function importarNovaTurma() {
    const file = await escolherArquivo('.xls,.xlsx,.ods,.csv');
    if (!file) return;
    let p;
    try { p = await lerPlanilha(file); } catch (e) { return toast('Erro ao ler: ' + e.message); }
    if (!p.alunos.length) return toast(p.avisos[0] || 'Não encontrei alunos nessa planilha.');

    const existente = db.turmas.find(t => p.meta.codigo && t.codigo === p.meta.codigo && t.turma === p.meta.turma && t.periodo === p.meta.periodo);
    if (existente) {
      const ok = await confirmar('Turma já existe', `Já existe a turma <b>${esc(CC.nomeTurma(existente))}</b> (${esc(existente.periodo)}). Usar esta planilha para atualizá-la?`, 'Atualizar');
      if (ok) return importarNaTurma(existente, p, file.name);
      return;
    }

    const temDados = p.datas.length || p.cronograma.length || p.notas.length;
    const datasPlanilha = p.datas.concat(p.cronograma.map(c => c.data)).sort();
    const sugestao = Object.assign({}, CC.DEFAULT_CONFIG, {
      dias: diasFrequentes(datasPlanilha),
      inicio: datasPlanilha[0] || '',
      fim: p.cronograma.length ? p.cronograma.map(c => c.data).sort().pop() : ''
    });
    const notasSugeridas = p.notas.filter(n => n.sugerida && !/^(VR|VS)$/.test(CC.norm(n.nome)));
    const planoSugerido = notasSugeridas.length
      ? notasSugeridas.map(n => ({ nome: n.nome, tipo: 'normal', data: '', peso: 1, max: n.max })).concat(CC.planoPadrao(0, true, true))
      : CC.planoPadrao(2, true, true);
    const r = await dialogo(`<h2>Nova turma</h2>
      <div class="stack">
      <label class="field">Disciplina<input type="text" name="disciplina" value="${esc(p.meta.disciplina)}"></label>
      <div class="row nowrap"><label class="field grow">Código<input type="text" name="codigo" value="${esc(p.meta.codigo)}"></label>
      <label class="field grow">Turma<input type="text" name="turma" value="${esc(p.meta.turma)}"></label>
      <label class="field grow">Período<input type="text" name="periodo" value="${esc(p.meta.periodo)}"></label></div>
      <p class="muted">${p.alunos.length} alunos encontrados em <i>${esc(file.name)}</i>.</p>
      ${temDados ? opcoesImportacao(p) : ''}
      ${p.avisos.length ? `<details class="muted small"><summary>${p.avisos.length} aviso(s)</summary><ul>${p.avisos.map(a => '<li>' + esc(a) + '</li>').join('')}</ul></details>` : ''}
      ${camposPeriodo(sugestao, !p.cronograma.length && !!sugestao.fim)}
      ${camposPlano(planoSugerido)}
      </div>
      <div class="acoes"><button class="btn" value="">Cancelar</button><button class="btn primary" value="ok">Criar turma</button></div>`, ligarPlano);
    if (r.acao !== 'ok') return;
    const t = CC.novaTurma(r.dados);
    const opts = lerOpcoes(r.dados, p);
    // O plano vem antes da importação: as notas da planilha entram nas avaliações de mesmo nome.
    CC.aplicarPlano(t, lerPlano(r.dados));
    // Planilha só com a lista (sem chamada): vale como lista oficial.
    if (!p.datas.length) CC.aplicarLista(t, p);
    const res = CC.importarDados(t, p, opts);
    aplicarPeriodo(t, lerPeriodo(r.dados), !!r.dados.gerar);
    db.turmas.push(t); salvar();
    toast(`${t.alunos.length} alunos · ${t.aulas.length} aulas · ${res.marcacoes} marcações importadas`);
    go('#/t/' + t.id + '/chamada');
  }

  function opcoesImportacao(p) {
    let h = '<div class="checks">';
    if (p.datas.length) h += `<label><input type="checkbox" name="chamada" checked> chamada (${p.datas.length} datas)</label>`;
    if (p.cronograma.length) h += `<label><input type="checkbox" name="cronograma" checked> cronograma (${p.cronograma.length} datas)</label>`;
    h += '</div>';
    if (p.notas.length) {
      h += '<p class="muted small" style="margin:10px 0 4px">Colunas que parecem notas:</p><div class="checks">' +
        p.notas.map(n => `<label><input type="checkbox" name="nota" value="${n.col}" ${n.sugerida ? 'checked' : ''}> ${esc(n.nome)}</label>`).join('') + '</div>';
    }
    return h;
  }

  function lerOpcoes(dados, p) {
    const sel = [].concat(dados.nota || []).map(Number);
    return {
      alunos: true,
      chamada: !!dados.chamada,
      cronograma: !!dados.cronograma,
      notas: p.notas.filter(n => sel.includes(n.col))
    };
  }

  /* ---------- componentes de formulário: período e plano de avaliação ---------- */

  /** Carga horária, dias da semana e período (início/fim) — para criar e configurar turmas. */
  function camposPeriodo(c, gerarMarcado) {
    const dias = c.dias || [];
    return `<fieldset class="grupo"><legend>Carga horária e aulas</legend><div class="stack">
      <div class="row nowrap">
      <label class="field grow">Carga horária (h)<input type="number" min="0" name="cargaHoraria" list="cargas" value="${c.cargaHoraria || ''}"></label>
      <label class="field grow">Horas por aula<input type="number" min="0" step="0.5" name="horasAula" value="${c.horasAula || ''}"></label></div>
      <datalist id="cargas"><option value="60"><option value="64"><option value="68"></datalist>
      <div><div class="muted small">Dias de aula (opcional)</div>
      <div class="checks">${[1, 2, 3, 4, 5, 6].map(d => `<label><input type="checkbox" name="dia" value="${d}" ${dias.includes(d) ? 'checked' : ''}> ${CC.DIAS[d]}</label>`).join('')}</div></div>
      <div class="row nowrap"><label class="field grow">Início das aulas<input type="date" name="inicio" value="${c.inicio || ''}"></label>
      <label class="field grow">Fim<input type="date" name="fim" value="${c.fim || ''}"></label></div>
      <label class="checks"><label><input type="checkbox" name="gerar" ${gerarMarcado ? 'checked' : ''}> gerar no cronograma as aulas que faltam</label></label>
      <p class="muted small">Com dias, início e fim preenchidos, as datas de aula entram no cronograma (feriados você marca depois como "Sem aula").</p>
      </div></fieldset>`;
  }

  function lerPeriodo(d) {
    const num = v => { const x = parseFloat(String(v == null ? '' : v).replace(',', '.')); return isNaN(x) ? 0 : x; };
    return {
      cargaHoraria: num(d.cargaHoraria), horasAula: num(d.horasAula),
      dias: [].concat(d.dia || []).map(Number), inicio: d.inicio || '', fim: d.fim || ''
    };
  }

  /** Aplica o período à turma e, se pedido, gera as aulas que faltam. Devolve quantas criou. */
  function aplicarPeriodo(t, per, gerar) {
    Object.assign(t.config, per);
    if (gerar && per.dias.length && per.inicio && per.fim && per.inicio <= per.fim) {
      return CC.gerarCronograma(t, per.inicio, per.fim, per.dias);
    }
    return 0;
  }

  function linhaPlano(v) {
    const tipo = v.tipo || 'normal';
    const normal = tipo === 'normal';
    return `<div class="plano-linha" data-tipo="${tipo}">
      <input type="hidden" name="pId" value="${esc(v.id || '')}"><input type="hidden" name="pTipo" value="${tipo}">
      <input type="text" name="pNome" value="${esc(v.nome)}" ${normal ? '' : 'readonly'} aria-label="Nome">
      <input type="date" name="pData" value="${esc(v.data || '')}" aria-label="Data">
      ${normal ? `<input type="text" inputmode="decimal" name="pPeso" value="${String(v.peso).replace('.', ',')}" aria-label="Peso">`
        : `<input type="hidden" name="pPeso" value="0"><span class="muted small" style="align-self:center;text-align:center">—</span>`}
      <input type="text" inputmode="decimal" name="pMax" value="${String(v.max).replace('.', ',')}" aria-label="Nota máxima">
    </div>`;
  }

  /** Plano de avaliação: quantas avaliações entram na média (nome, data, peso, nota máxima) + VR e VS. */
  function camposPlano(plano, cfg) {
    const c = cfg || CC.DEFAULT_CONFIG;
    const normais = plano.filter(v => !v.tipo || v.tipo === 'normal');
    const vr = plano.find(v => v.tipo === 'VR'), vs = plano.find(v => v.tipo === 'VS');
    return `<fieldset class="grupo"><legend>Avaliações</legend>
      <label class="field">Quantas entram na média<input type="number" name="nAval" min="0" max="12" value="${normais.length}"></label>
      <div class="plano-cab muted small"><span>Nome</span><span>Data</span><span>Peso</span><span>Máx.</span></div>
      <div class="plano-normais">${normais.map(linhaPlano).join('')}</div>
      <div class="checks" style="margin-top:10px">
        <label><input type="checkbox" name="temVR" ${vr ? 'checked' : ''}> VR — substitui a nota da prova perdida</label>
        <label><input type="checkbox" name="temVS" ${vs ? 'checked' : ''}> VS — para média entre ${CC.numBR(c.mediaVS)} e ${CC.numBR(c.mediaMin)}</label></div>
      <div class="plano-extra">
        ${linhaPlano(vr || { nome: 'VR', tipo: 'VR', data: '', peso: 0, max: 10 })}
        ${linhaPlano(vs || { nome: 'VS', tipo: 'VS', data: '', peso: 0, max: 10 })}</div>
      <p class="muted small">Média = soma(peso × nota ÷ máx. × 10) ÷ soma dos pesos. A data marca a aula como avaliação no cronograma.</p>
      </fieldset>`;
  }

  /** Liga o número de avaliações às linhas e as caixas VR/VS às linhas extras. */
  function ligarPlano(form) {
    const box = form.querySelector('.plano-normais');
    if (!box) return;
    const n = form.querySelector('[name=nAval]');
    n.addEventListener('input', () => {
      const alvo = Math.max(0, Math.min(12, parseInt(n.value, 10) || 0));
      while (box.children.length > alvo) box.lastElementChild.remove();
      while (box.children.length < alvo) {
        const k = box.children.length + 1;
        box.insertAdjacentHTML('beforeend', linhaPlano({ nome: 'P' + k, tipo: 'normal', data: '', peso: 1, max: 10 }));
      }
    });
    const extra = tipo => form.querySelector(`.plano-extra [data-tipo="${tipo}"]`);
    const sync = () => ['VR', 'VS'].forEach(tipo => {
      const on = form.querySelector(`[name=tem${tipo}]`).checked;
      const row = extra(tipo);
      row.hidden = !on;
      row.querySelectorAll('input').forEach(i => { i.disabled = !on; });
    });
    form.querySelectorAll('[name=temVR],[name=temVS]').forEach(c => c.addEventListener('change', sync));
    sync();
  }

  function lerPlano(d) {
    const arr = k => [].concat(d[k] == null ? [] : d[k]);
    const ids = arr('pId'), tipos = arr('pTipo'), nomes = arr('pNome'), datas = arr('pData'), pesos = arr('pPeso'), maxs = arr('pMax');
    const num = (v, padrao) => { const x = parseFloat(String(v).replace(',', '.')); return isNaN(x) ? padrao : x; };
    return nomes.map((nome, i) => ({
      id: ids[i] || null, tipo: tipos[i] || 'normal', nome: String(nome).trim(), data: datas[i] || '',
      peso: tipos[i] === 'normal' ? num(pesos[i], 1) : 0, max: num(maxs[i], 10)
    })).filter(v => v.nome && v.max > 0);
  }

  /** Plano atual da turma (para preencher o editor). */
  function planoDaTurma(t) {
    return t.avaliacoes.map(v => ({ id: v.id, nome: v.nome, tipo: v.tipo || 'normal', data: v.data || '', peso: v.peso, max: v.max }));
  }

  async function editarPlano(t) {
    const r = await dialogo(`<h2>Plano de avaliação</h2>${camposPlano(planoDaTurma(t), t.config)}
      <div class="acoes"><button class="btn" value="" formnovalidate>Cancelar</button><button class="btn primary" value="ok">Salvar</button></div>`, ligarPlano);
    if (r.acao !== 'ok') return;
    const plano = lerPlano(r.dados);
    const ficam = new Set(plano.map(v => v.id).filter(Boolean));
    const somem = t.avaliacoes.filter(v => !ficam.has(v.id) && Object.keys(t.notas[v.id] || {}).length);
    if (somem.length) {
      const ok = await confirmar('Remover avaliações com notas', `${somem.map(v => '<b>' + esc(v.nome) + '</b>').join(', ')} já ${somem.length > 1 ? 'têm' : 'tem'} notas lançadas, que serão apagadas. Continuar?`, 'Remover', true);
      if (!ok) return;
    }
    CC.aplicarPlano(t, plano);
    salvar(); go(`#/t/${t.id}/notas`);
    toast('Plano salvo');
  }

  /** Dias da semana que aparecem pelo menos duas vezes numa lista de datas. */
  function diasFrequentes(datas) {
    const n = {};
    datas.forEach(d => { const w = CC.weekday(d); n[w] = (n[w] || 0) + 1; });
    return Object.keys(n).filter(w => n[w] >= 2).map(Number).sort();
  }

  /* ---------- menu da turma: atualizar lista, importar, exportar ---------- */

  function menuTurma(t) {
    dialogo(`<h2>${esc(CC.nomeTurma(t))}</h2><ul class="menu-list">
      <li><button value="exportar">Exportar planilha (.xlsx)</button></li>
      <li><button value="presenca">Lista de presença para assinatura (na planilha)</button></li>
      <li><button value="email">Enviar e-mail aos alunos</button></li>
      <li><button value="lista">Atualizar lista de alunos (planilha nova do sistema)</button></li>
      <li><button value="importar">Importar chamada / notas / cronograma de planilha</button></li>
      <li class="sep"></li>
      <li><button value="plano">Plano de avaliação</button></li>
      <li><button value="config">Configurações da turma</button></li>
      <li><button value="pasta">Pasta de trabalho desta turma</button></li>
      <li><button value="backup">Salvar backup desta turma</button></li>
      <li><button value="arquivar">${t.arquivada ? 'Desarquivar turma' : 'Arquivar turma (fim do período)'}</button></li>
      <li class="sep"></li>
      <li><button value="excluir" class="danger" style="color:var(--danger)">Excluir turma</button></li>
      </ul>`).then(r => {
      if (r.acao === 'exportar') exportar(t, null);
      if (r.acao === 'presenca') exportar(t, null);
      if (r.acao === 'email') enviarEmail(t, null);
      if (r.acao === 'arquivar') alternarArquivo(t);
      if (r.acao === 'pasta') configurarPasta(t);
      if (r.acao === 'lista') atualizarLista(t);
      if (r.acao === 'importar') importarArquivoNaTurma(t);
      if (r.acao === 'config') configTurma(t);
      if (r.acao === 'plano') editarPlano(t);
      if (r.acao === 'backup') salvarBackup(t);
      if (r.acao === 'excluir') excluirTurma(t);
    });
  }

  async function atualizarLista(t) {
    const file = await escolherArquivo('.xls,.xlsx,.ods,.csv', false, t);
    if (!file) return;
    let p;
    try { p = await lerPlanilha(file); } catch (e) { return toast('Erro ao ler: ' + e.message); }
    if (!p.alunos.length) return toast(p.avisos[0] || 'Não encontrei alunos nessa planilha.');
    if (p.meta.codigo && t.codigo && (p.meta.codigo !== t.codigo || (p.meta.turma && t.turma && p.meta.turma !== t.turma))) {
      const ok = await confirmar('Turma diferente?', `A planilha é de <b>${esc(p.meta.codigo + ' ' + p.meta.turma)}</b>, mas esta turma é <b>${esc(t.codigo + ' ' + t.turma)}</b>. Continuar mesmo assim?`, 'Continuar');
      if (!ok) return;
    }
    const plano = CC.diffLista(t, p);
    const lista = (arr, f) => arr.length ? '<ul>' + arr.map(x => '<li>' + esc(f(x)) + '</li>').join('') + '</ul>' : '';
    const r = await dialogo(`<h2>Atualizar lista</h2><div class="scroll">
      <p><b>${plano.novos.length}</b> novo(s)${lista(plano.novos, a => a.nome)}</p>
      <p><b>${plano.saem.length}</b> sai(em) da lista <span class="muted small">(o histórico é mantido)</span>${lista(plano.saem, a => a.nome)}</p>
      ${plano.voltaram.length ? `<p><b>${plano.voltaram.length}</b> voltam à lista${lista(plano.voltaram, a => a.nome)}</p>` : ''}
      ${plano.alterados.length ? `<p><b>${plano.alterados.length}</b> com dados alterados${lista(plano.alterados, x => x.aluno.nome + ' (' + x.campos.join(', ') + ')')}</p>` : ''}
      <p class="muted">${plano.mantidos} sem mudança.</p></div>
      <div class="acoes"><button class="btn" value="">Cancelar</button><button class="btn primary" value="ok">Aplicar</button></div>`);
    if (r.acao !== 'ok') return;
    CC.aplicarLista(t, p);
    salvar(); render();
    toast('Lista atualizada');
  }

  async function importarArquivoNaTurma(t) {
    const file = await escolherArquivo('.xls,.xlsx,.ods,.csv', false, t);
    if (!file) return;
    let p;
    try { p = await lerPlanilha(file); } catch (e) { return toast('Erro ao ler: ' + e.message); }
    importarNaTurma(t, p, file.name);
  }

  async function importarNaTurma(t, p, nomeArq) {
    if (!p.datas.length && !p.cronograma.length && !p.notas.length) {
      // Só a lista: tratar como atualização da lista oficial.
      const plano = CC.aplicarLista(t, p);
      salvar(); render();
      return toast(`Lista atualizada: ${plano.novos.length} novos, ${plano.saem.length} saíram`);
    }
    const r = await dialogo(`<h2>Importar de ${esc(nomeArq)}</h2>
      <p class="muted small">Só preenche o que ainda está vazio no app; nada que você já marcou é sobrescrito.
      Alunos da planilha que não estão na lista oficial entram como "fora da lista".</p>
      ${opcoesImportacao(p)}
      <div class="acoes"><button class="btn" value="">Cancelar</button><button class="btn primary" value="ok">Importar</button></div>`);
    if (r.acao !== 'ok') return;
    const res = CC.importarDados(t, p, lerOpcoes(r.dados, p));
    salvar(); render();
    toast(`${res.aulasNovas} aulas, ${res.marcacoes} marcações, ${res.notas} notas, ${res.alunosNovos} alunos novos`);
  }

  /** Exporta a planilha; antes pergunta o cabeçalho da aba "Lista de presença". */
  async function exportar(t, aula) {
    if (!window.XLSX) return toast('Biblioteca de planilhas não carregou (abra o app uma vez com internet).');
    if (!aula) {
      const hoje = CC.todayISO();
      aula = CC.aulasOrdenadas(t).find(a => a.tipo === 'avaliacao' && a.data >= hoje) || null;
    }
    const st = CC.alunosOrdenados(t, false).filter(a => CC.reprovadoPorFalta(t, CC.statsAluno(t, a).faltas)).length;
    const r = await dialogo(`<h2>Exportar planilha</h2>
      <p class="muted small">Abas: Chamada, Lista de presença, Notas, Cronograma, Alunos, Observações e Configuração.</p>
      <div class="stack"><b class="small">Lista de presença (para assinatura)</b>
      <label class="field">Título<input type="text" name="titulo" value="${esc(aula && aula.conteudo ? aula.conteudo : '')}" placeholder="ex.: P1 (pode deixar vazio)"></label>
      <div class="row nowrap"><label class="field grow">Data<input type="date" name="data" value="${aula ? aula.data : ''}"></label>
      <label class="field grow">Linhas em branco<input type="number" name="extras" min="0" max="40" value="3"></label></div>
      <p class="muted small">${st ? `${st} aluno(s) com mais de ${CC.numBR(CC.limiteFaltas(t), CC.limiteFaltas(t) % 1 ? 1 : 0)} faltas aparecerão com o nome riscado.` : `Quem passar de ${CC.numBR(CC.limiteFaltas(t), CC.limiteFaltas(t) % 1 ? 1 : 0)} faltas aparece com o nome riscado.`}</p></div>
      <div class="acoes"><button class="btn" value="">Cancelar</button><button class="btn primary" value="ok">Exportar</button></div>`);
    if (r.acao !== 'ok') return;
    const wb = CC.montarPlanilha(XLSX, t, cursos(), {
      lista: { titulo: r.dados.titulo.trim(), data: r.dados.data, extras: Math.max(0, Math.min(40, parseInt(r.dados.extras, 10) || 0)) }
    });
    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array', compression: true });
    entregarArquivo(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), CC.nomeArquivo(t, 'xlsx'), t);
  }

  async function configTurma(t) {
    const c = t.config;
    const r = await dialogo(`<h2>Configurações</h2><div class="stack">
      <label class="field">Disciplina<input type="text" name="disciplina" value="${esc(t.disciplina)}"></label>
      <div class="row nowrap"><label class="field grow">Código<input type="text" name="codigo" value="${esc(t.codigo)}"></label>
      <label class="field grow">Turma<input type="text" name="turma" value="${esc(t.turma)}"></label>
      <label class="field grow">Período<input type="text" name="periodo" value="${esc(t.periodo)}"></label></div>
      <div class="row nowrap">
      <label class="field grow">Atraso vale (faltas)<input type="number" step="0.05" min="0" max="1" name="pesoAtraso" value="${c.pesoAtraso}"></label>
      <label class="field grow">Frequência mínima (%)<input type="number" min="0" max="100" name="freqMin" value="${c.freqMin}"></label>
      <label class="field grow">Média mínima<input type="number" step="0.1" min="0" max="10" name="mediaMin" value="${c.mediaMin}"></label></div>
      <label class="field">Com média parcial a partir de (faz VS)<input type="number" step="0.1" min="0" max="10" name="mediaVS" value="${c.mediaVS}"></label>
      ${camposPeriodo(c, false)}
      <p class="muted small">Hoje: ${CC.aulasPrevistas(t)} aulas no período; reprova quem tiver mais de ${CC.numBR(CC.limiteFaltas(t), CC.limiteFaltas(t) % 1 ? 1 : 0)} faltas.
      Sem carga horária, conta as aulas do cronograma.</p></div>
      <div class="acoes"><button class="btn" value="">Cancelar</button><button class="btn primary" value="ok">Salvar</button></div>`);
    if (r.acao !== 'ok') return;
    ['disciplina', 'codigo', 'turma', 'periodo'].forEach(k => { t[k] = r.dados[k].trim(); });
    ['pesoAtraso', 'freqMin', 'mediaMin', 'mediaVS'].forEach(k => {
      const v = parseFloat(String(r.dados[k]).replace(',', '.'));
      if (!isNaN(v)) c[k] = v;
    });
    delete c.totalAulas;
    const novas = aplicarPeriodo(t, lerPeriodo(r.dados), !!r.dados.gerar);
    salvar(); render();
    if (novas) toast(novas + ' aula(s) adicionada(s) ao cronograma');
  }

  async function excluirTurma(t) {
    const ok = await confirmar('Excluir turma', `Apagar <b>${esc(CC.nomeTurma(t))}</b> e toda a chamada e notas dela deste aparelho? Se quiser guardar, exporte ou faça backup antes.`, 'Excluir', true);
    if (!ok) return;
    db.turmas = db.turmas.filter(x => x.id !== t.id);
    salvar(); go('#/');
  }

  function salvarBackup(t) {
    const dados = t ? { versao: 1, turmas: [t] } : db;
    const nome = t ? CC.nomeArquivo(t, 'backup.json') : 'chamada-backup-' + CC.todayISO() + '.json';
    entregarArquivo(new Blob([JSON.stringify(dados)], { type: 'application/json' }), nome, t || null);
  }

  async function restaurarBackup() {
    const file = await escolherArquivo('.json,application/json');
    if (!file) return;
    let dados;
    try { dados = JSON.parse(await file.text()); } catch (e) { return toast('Arquivo de backup inválido'); }
    if (!dados || !Array.isArray(dados.turmas)) return toast('Arquivo de backup inválido');
    const conflitos = dados.turmas.filter(t => turma(t.id));
    let substituir = true;
    if (conflitos.length) {
      substituir = await confirmar('Restaurar backup', `${conflitos.length} turma(s) do backup já existem aqui. Substituir pelas versões do backup?`, 'Substituir', true);
      if (!substituir) return;
    }
    dados.turmas.forEach(t => {
      t.config = Object.assign({}, CC.DEFAULT_CONFIG, t.config);
      const i = db.turmas.findIndex(x => x.id === t.id);
      if (i >= 0) db.turmas[i] = t; else db.turmas.push(t);
    });
    salvar(); go('#/');
    toast(dados.turmas.length + ' turma(s) restaurada(s)');
  }

  /* ---------- cursos ---------- */

  function resumoCursos(alunos) {
    const n = {};
    alunos.forEach(a => { const c = cursoDe(a) || 'sem matrícula'; n[c] = (n[c] || 0) + 1; });
    return Object.keys(n).sort((x, y) => n[y] - n[x]).map(c => esc(c) + ': ' + n[c]).join(' · ');
  }

  async function editarCursos() {
    const tab = cursos();
    const usados = CC.cursosEncontrados(db.turmas);
    const codigos = Array.from(new Set(Object.keys(tab).concat(Object.keys(usados)))).sort();
    const texto = codigos.map(c => c + ' = ' + (tab[c] || '')).join('\n');
    const semNome = Object.keys(usados).filter(c => !tab[c]);
    const r = await dialogo(`<h2>Códigos de curso</h2>
      <p class="muted small">Um por linha: <b>código = nome</b>. O código são os dígitos 4 a 6 da matrícula
      (2&nbsp;23&nbsp;<b>031</b>&nbsp;134 → 031). A tabela inicial é a da UFF de 2006; corrija ou acrescente o que faltar.</p>
      ${semNome.length ? `<p class="small" style="color:var(--A)">Códigos das suas turmas ainda sem nome: ${semNome.join(', ')}</p>` : ''}
      <textarea name="tabela" style="min-height:45vh;font-family:monospace;font-size:14px">${esc(texto)}</textarea>
      <div class="acoes"><button class="btn danger" value="padrao" formnovalidate>Restaurar tabela da UFF</button>
      <button class="btn" value="">Cancelar</button><button class="btn primary" value="ok">Salvar</button></div>`);
    if (r.acao === 'padrao') { delete db.cursos; salvar(); render(); return toast('Tabela da UFF restaurada'); }
    if (r.acao !== 'ok') return;
    const nova = {};
    String(r.dados.tabela).split(/\r?\n/).forEach(l => {
      const m = l.match(/^\s*(\d{1,3})\s*[=:;\t-]\s*(.+?)\s*$/);
      if (m) nova[m[1].padStart(3, '0')] = m[2];
    });
    db.cursos = nova;
    salvar(); render();
    toast(Object.keys(nova).length + ' cursos salvos');
  }

  /* ---------- leitura de folha de presença por foto (OCR no aparelho) ---------- */

  const ETAPAS_OCR = {
    'loading tesseract core': 'Carregando o leitor de texto…',
    'initializing tesseract': 'Preparando o leitor…',
    'loading language traineddata': 'Carregando o português (só na 1ª vez demora)…',
    'initializing api': 'Preparando o leitor…',
    'recognizing text': 'Lendo a folha…'
  };

  function progressoOCR(texto, frac) {
    const el = document.querySelector('#ocr-progresso');
    if (!el) return;
    el.querySelector('.txt').textContent = texto;
    el.querySelector('progress').value = frac || 0;
  }

  async function lerFolhaPresenca(t, aula) {
    const fotos = await escolherDoSistema('image/*', true);
    if (!fotos || !fotos.length) return;
    const dlg = $('#dlg'), form = $('#dlg-form');
    form.innerHTML = `<h2>Lendo ${fotos.length > 1 ? fotos.length + ' fotos' : 'a foto'}</h2>
      <div id="ocr-progresso"><p class="txt muted">Começando…</p><progress max="1" value="0" style="width:100%"></progress></div>
      <p class="muted small">Tudo é feito no aparelho; a foto não sai do celular.</p>`;
    dlg.returnValue = '';
    dlg.showModal();
    const alunos = CC.alunosOrdenados(t, false);
    let linhas = [], tipo = 'mao';
    try {
      for (let k = 0; k < fotos.length; k++) {
        const r = await OCR.lerFolha(fotos[k], alunos, (st, p) => {
          progressoOCR((fotos.length > 1 ? `Foto ${k + 1} de ${fotos.length}: ` : '') + (ETAPAS_OCR[st] || 'Processando…'), st === 'recognizing text' ? p : 0);
        }, cursoDe);
        if (r.tipo === 'impressa') tipo = 'impressa';
        linhas = linhas.concat(r.linhas);
      }
    } catch (e) {
      await fecharDialogo();
      return toast('Não consegui ler a foto: ' + e.message);
    }
    await fecharDialogo();
    // Entre fotos diferentes, um aluno também só vale uma vez (fica a linha de maior score).
    const melhor = new Map();
    linhas.forEach((l, i) => {
      if (!l.aluno) return;
      const j = melhor.get(l.aluno.id);
      if (j == null || l.candidatos[0].score > linhas[j].candidatos[0].score) melhor.set(l.aluno.id, i);
    });
    linhas.forEach((l, i) => { if (l.aluno && melhor.get(l.aluno.id) !== i) { l.aluno = null; l.presente = false; l.duplicada = true; } });
    conferirLeitura(t, aula, linhas, tipo);
  }

  async function conferirLeitura(t, aula, linhas, tipo) {
    const alunos = CC.alunosOrdenados(t, false);
    const opcoes = sel => '<option value="">— ignorar esta linha —</option>' +
      alunos.map(a => `<option value="${a.id}" ${sel && sel.id === a.id ? 'selected' : ''}>${esc(nomeCurto(a.nome))}</option>`).join('');
    const reconhecidos = new Set(linhas.filter(l => l.aluno).map(l => l.aluno.id));
    const fora = alunos.filter(a => !reconhecidos.has(a.id));
    const nPres = linhas.filter(l => l.presente).length;
    const r = await dialogo(`<h2>Conferir leitura · ${CC.fmtDate(aula.data, true)}</h2>
      <p class="muted small">${tipo === 'impressa' ? 'Lista impressa: presente = linha com assinatura.' : 'Folha escrita à mão: cada linha foi comparada com os alunos da turma.'}
      ${nPres} presença(s) sugerida(s). Confira as linhas, corrija o aluno quando preciso e desmarque o que estiver errado.</p>
      <div class="ocr-lista">${linhas.map((l, i) => `
        <div class="ocr-item ${l.presente ? 'on' : ''}">
          <img src="${l.imagem}" alt="linha ${i + 1} da foto">
          <div class="row nowrap">
            <label class="ocr-check"><input type="checkbox" name="ocrP" value="${i}" ${l.presente ? 'checked' : ''}> presente</label>
            <select name="ocrA">${opcoes(l.aluno)}</select>
          </div>
          <div class="muted small">lido: “${esc(l.texto.slice(0, 70))}”${l.aluno ? ` · ${Math.round(l.candidatos[0].score * 100)}% pela ${l.candidatos[0].via}` : l.duplicada ? ' · aluno já reconhecido em outra linha' : ''}${l.tinta != null ? ` · ${l.tinta > 0.06 ? 'com' : 'sem'} assinatura` : ''}</div>
        </div>`).join('')}</div>
      ${fora.length ? `<details ${tipo === 'impressa' ? 'open' : ''}><summary class="small"><b>${fora.length}</b> aluno(s) não encontrados na foto — marque quem estava presente</summary>
        <div class="checks" style="margin-top:8px">${fora.map(a => `<label><input type="checkbox" name="ocrExtra" value="${a.id}"> ${esc(nomeCurto(a.nome))}</label>`).join('')}</div></details>` : ''}
      <label class="checks" style="margin-top:12px"><label><input type="checkbox" name="demaisF" checked> marcar os demais como falta</label></label>
      <div class="acoes"><button class="btn" value="">Cancelar</button><button class="btn primary" value="ok">Aplicar na chamada</button></div>`,
    form => {
      // Escolher um aluno numa linha já marca "presente"; "ignorar" desmarca.
      form.querySelectorAll('.ocr-item').forEach(div => {
        const sel = div.querySelector('select'), chk = div.querySelector('input[type=checkbox]');
        sel.addEventListener('change', () => { chk.checked = !!sel.value; div.classList.toggle('on', chk.checked); });
        chk.addEventListener('change', () => div.classList.toggle('on', chk.checked));
      });
    });
    if (r.acao !== 'ok') return;
    const escolhidos = [].concat(r.dados.ocrA == null ? [] : r.dados.ocrA);
    const marcadas = new Set([].concat(r.dados.ocrP || []).map(Number));
    const presentes = new Set(escolhidos.filter((id, i) => id && marcadas.has(i)));
    [].concat(r.dados.ocrExtra || []).forEach(id => presentes.add(id));
    const m = t.presencas[aula.id] || (t.presencas[aula.id] = {});
    let nP = 0, nF = 0;
    presentes.forEach(id => { if (!m[id] || m[id] === 'F') { m[id] = 'P'; nP++; } });
    if (r.dados.demaisF) t.alunos.filter(a => a.ativo && !m[a.id]).forEach(a => { m[a.id] = 'F'; nF++; });
    salvar(); render();
    toast(`${nP} presença(s) e ${nF} falta(s) registradas`);
  }

  /* ---------- filtros e ordenação (Resumo, Alunos, Notas) ---------- */

  const visoes = {};
  function visaoDe(t) { return visoes[t.id] || (visoes[t.id] = { filtro: 'todos', ordem: 'nome', curso: '' }); }

  function barraVisao(t, total, lista) {
    const v = visaoDe(t);
    const cursosT = Array.from(new Set(CC.alunosOrdenados(t, false).map(cursoDe).filter(Boolean))).sort();
    const sel = (id, obj, atual) => `<select id="${id}">${Object.keys(obj).map(k => `<option value="${k}" ${atual === k ? 'selected' : ''}>${obj[k].rotulo}</option>`).join('')}</select>`;
    return `<div class="card barra-visao"><div class="row nowrap">
      <label class="field grow">Mostrar${sel('v-filtro', CC.FILTROS, v.filtro)}</label>
      <label class="field grow">Ordenar por${sel('v-ordem', CC.ORDENS, v.ordem)}</label></div>
      ${cursosT.length > 1 ? `<label class="field" style="margin-top:6px">Curso<select id="v-curso"><option value="">Todos os cursos</option>${cursosT.map(c => `<option ${v.curso === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>` : ''}
      <div class="row small muted" style="margin-top:8px"><span>${lista.length} de ${total} aluno(s)</span>
      <button class="btn small right" id="v-email" type="button" ${lista.length ? '' : 'disabled'}>✉ E-mail para estes</button></div></div>`;
  }

  function ligarBarraVisao(t, lista) {
    ['filtro', 'ordem', 'curso'].forEach(k => {
      const el = $('#v-' + k);
      if (el) el.onchange = () => { visaoDe(t)[k] = el.value; render(); };
    });
    const em = $('#v-email');
    if (em) em.onclick = () => enviarEmail(t, lista.map(x => x.a));
  }

  /* ---------- estatísticas de notas ---------- */

  function miniHist(h) {
    const mx = Math.max.apply(null, h) || 1;
    return `<span class="hist" title="Distribuição de 0 a 10">${h.map((c, k) => `<i style="height:${Math.max(4, Math.round(c / mx * 100))}%;${c ? '' : 'opacity:.25'}" title="${k} a ${k + 1}: ${c}"></i>`).join('')}</span>`;
  }

  function cartaoEstatisticas(t) {
    const e = CC.estatisticasNotas(t);
    if (!e.avaliacoes.some(x => x.n)) return '';
    const f = (x, casas) => x == null ? '—' : CC.numBR(x, casas == null ? 1 : casas);
    const s = e.situacao;
    return `<div class="card"><h3>Estatísticas</h3>
      <div class="muted small" style="margin-bottom:8px">${e.total} inscritos ·
        <span class="tag OK">${s.aprovados} com média suficiente</span>
        ${CC.avaliacaoTipo(t, 'VS') ? `<span class="tag VS">${s.vs} em VS</span>` : ''}
        <span class="tag BAIXA">${s.nota} abaixo da média</span>
        <span class="tag RF">${s.rf} reprovados por falta</span>
        ${s.semnota ? `<span class="tag fora">${s.semnota} sem notas</span>` : ''}</div>
      <div class="tabela-wrap" style="box-shadow:none"><table><thead><tr><th></th><th class="num">Notas</th><th class="num">Média</th><th class="num opc">Mediana</th><th class="num opc">Mín–máx</th><th class="num">≥ ${f(t.config.mediaMin)}</th><th>Distribuição</th></tr></thead><tbody>` +
      e.avaliacoes.map(x => `<tr${x.media_ ? ' class="linha-media"' : ''}><td><b>${esc(x.nome)}</b>${x.escala !== 10 ? ` <span class="muted small">/ ${x.escala}</span>` : ''}</td>
        <td class="num">${x.n}/${x.total}</td><td class="num">${f(x.media)}</td><td class="num opc">${f(x.mediana)}</td>
        <td class="num opc">${x.n ? f(x.min) + '–' + f(x.max) : '—'}</td><td class="num">${x.acima == null ? '—' : Math.round(x.acima * 100) + '%'}</td>
        <td>${x.n ? miniHist(x.hist) : ''}</td></tr>`).join('') +
      `</tbody></table></div><p class="muted small" style="margin:6px 0 0">Desvio padrão: ${e.avaliacoes.filter(x => x.n > 1).map(x => esc(x.nome) + ' ' + f(x.dp)).join(' · ') || '—'}</p></div>`;
  }

  /* ---------- e-mail (pelo app de e-mail do aparelho) ---------- */

  function copiar(texto, msg) {
    (navigator.clipboard ? navigator.clipboard.writeText(texto) : Promise.reject())
      .then(() => toast(msg || 'Copiado'), () => toast('Não consegui copiar'));
  }

  function mailto(para, bcc, assunto, corpo) {
    const q = [];
    if (bcc && bcc.length) q.push('bcc=' + encodeURIComponent(bcc.join(',')));
    q.push('subject=' + encodeURIComponent(assunto));
    q.push('body=' + encodeURIComponent(corpo));
    return 'mailto:' + encodeURIComponent(para || '') + '?' + q.join('&');
  }

  /**
   * Escreve e envia e-mail aos alunos. Aviso: mesma mensagem para todos, em cópia oculta.
   * Personalizado: uma mensagem por aluno, com {campos} preenchidos; cada uma abre no app de e-mail.
   */
  async function enviarEmail(t, lista) {
    const todos = CC.alunosOrdenados(t, false);
    const risco = todos.filter(a => { const c = CC.statsAluno(t, a).situacao.cod; return c === 'RF' || c === 'LIM'; });
    const grupos = [];
    if (lista && lista.length && lista.length !== todos.length) grupos.push(['lista', lista.length === 1 ? CC.titleCase(lista[0].nome) : `Os ${lista.length} alunos da lista atual`, lista]);
    grupos.push(['todos', `Todos os inscritos (${todos.length})`, todos]);
    if (risco.length) grupos.push(['risco', `Perto do limite ou reprovados por falta (${risco.length})`, risco]);
    const modelos = CC.MODELOS_EMAIL.concat(db.modelosEmail || []);
    const inicial = lista && lista.length === 1 ? modelos.find(m => m.id === 'resumo') : modelos[0];
    const campos = Object.keys(CC.CAMPOS_EMAIL).map(k => `<code>{${k}}</code> ${CC.CAMPOS_EMAIL[k]}`).join(' · ');
    const r = await dialogo(`<h2>Enviar e-mail</h2><div class="stack">
      <label class="field">Para<select name="grupo">${grupos.map(g => `<option value="${g[0]}">${esc(g[1])}</option>`).join('')}</select></label>
      <label class="field">Modelo<select name="modelo">${modelos.map(m => `<option value="${m.id}" ${m === inicial ? 'selected' : ''}>${esc(m.nome)}</option>`).join('')}</select></label>
      <div class="checks"><label><input type="radio" name="tipo" value="aviso"> mesma mensagem para todos (cópia oculta)</label>
        <label><input type="radio" name="tipo" value="pessoal"> uma mensagem personalizada por aluno</label></div>
      <label class="field">Assunto<input type="text" name="assunto"></label>
      <label class="field">Mensagem<textarea name="corpo" rows="8"></textarea></label>
      <label class="field">Assinatura<textarea name="assinatura" rows="2" placeholder="ex.: Prof. Fulano — IC/UFF">${esc(db.assinatura || '')}</textarea></label>
      <details class="muted small"><summary>Campos que você pode usar na mensagem personalizada</summary><p>${campos}</p></details>
      <div class="row nowrap"><label class="checks"><label><input type="checkbox" name="salvar"> salvar como modelo</label></label>
        <input type="text" name="nomeModelo" placeholder="nome do modelo" class="grow"></div>
      </div>
      <div class="acoes"><button class="btn" value="" formnovalidate>Cancelar</button><button class="btn primary" value="ok">Continuar</button></div>`,
    form => {
      const preencher = () => {
        const m = modelos.find(x => x.id === form.modelo.value);
        form.assunto.value = m.assunto; form.corpo.value = m.corpo;
        form.querySelector(`[name=tipo][value=${m.tipo}]`).checked = true;
      };
      form.modelo.addEventListener('change', preencher);
      preencher();
    });
    if (r.acao !== 'ok') return;
    const d = r.dados;
    db.assinatura = String(d.assinatura || '').trim();
    if (d.salvar) {
      (db.modelosEmail = db.modelosEmail || []).push({ id: CC.uid('m'), nome: String(d.nomeModelo || '').trim() || String(d.assunto).trim() || 'Modelo', tipo: d.tipo, assunto: d.assunto, corpo: d.corpo });
    }
    salvar();
    const alvo = grupos.find(g => g[0] === d.grupo)[2];
    const comEmail = alvo.filter(a => a.email), semEmail = alvo.filter(a => !a.email);
    const corpo = String(d.corpo).replace(/\s+$/, '') + (db.assinatura ? '\n\n' + db.assinatura : '');
    const avisoSem = semEmail.length ? `<p class="small" style="color:var(--A)">Sem e-mail cadastrado: ${semEmail.map(a => esc(nomeCurto(a.nome))).join(', ')}</p>` : '';
    if (!comEmail.length) return toast('Nenhum destinatário tem e-mail cadastrado');

    if (d.tipo === 'aviso') {
      const assunto = CC.preencherModelo(d.assunto, t, null), texto = CC.preencherModelo(corpo, t, null);
      // Endereços longos demais quebram alguns apps de e-mail: divide em partes.
      const partes = [];
      let atual = [];
      comEmail.forEach(a => {
        if (atual.length && mailto('', atual.concat(a.email), assunto, texto).length > 1900) { partes.push(atual); atual = []; }
        atual.push(a.email);
      });
      if (atual.length) partes.push(atual);
      await dialogo(`<h2>Aviso para ${comEmail.length} aluno(s)</h2>
        <p class="muted small">Os endereços vão em cópia oculta (um não vê o e-mail do outro).</p>
        <div class="stack">${partes.map((p, k) => `<a class="btn primary block" href="${mailto('', p, assunto, texto)}">Abrir no e-mail${partes.length > 1 ? ` — parte ${k + 1} de ${partes.length} (${p.length})` : ''}</a>`).join('')}
        <div class="row"><button class="btn small" type="button" id="cp-end">Copiar endereços</button><button class="btn small" type="button" id="cp-msg">Copiar mensagem</button></div></div>
        ${avisoSem}
        <div class="acoes"><button class="btn" value="">Fechar</button></div>`, form => {
        form.querySelector('#cp-end').onclick = () => copiar(comEmail.map(a => a.email).join(', '), 'Endereços copiados');
        form.querySelector('#cp-msg').onclick = () => copiar(assunto + '\n\n' + texto, 'Mensagem copiada');
      });
      return;
    }

    await dialogo(`<h2>Mensagens personalizadas</h2>
      <p class="muted small">Toque em "Enviar" em cada aluno: a mensagem dele abre no app de e-mail, já preenchida. Volte aqui para o próximo.</p>
      <div class="lista-chamada envio">${comEmail.map(a => {
        const texto = CC.preencherModelo(corpo, t, a);
        return `<div class="aluno-row"><div class="nome">${esc(nomeCurto(a.nome))}<div class="det">${esc(texto.split('\n').filter(Boolean)[1] || texto.split('\n')[0]).slice(0, 90)}</div></div>
          <a class="btn small" href="${mailto(a.email, null, CC.preencherModelo(d.assunto, t, a), texto)}" data-env>Enviar</a></div>`;
      }).join('')}</div>${avisoSem}
      <div class="acoes"><button class="btn" value="">Fechar</button></div>`, form => {
      form.querySelectorAll('[data-env]').forEach(a => a.addEventListener('click', () => {
        a.textContent = '✓ Enviado'; a.closest('.aluno-row').classList.add('enviado');
      }));
    });
  }

  /* ---------- pasta de trabalho ---------- */

  async function configurarPasta(t) {
    if (!Pasta.suportada) {
      return dialogo(`<h2>Pasta de trabalho</h2>
        <p>Este navegador ainda não permite que o app escolha uma pasta.</p>
        <p class="muted small">Ao exportar, use <b>Compartilhar</b> para mandar ao Google Drive (ou outro app) ou <b>Baixar</b> para a pasta Downloads; ao importar, o seletor de arquivos do sistema abre em qualquer pasta. No computador (Chrome ou Edge), a pasta de trabalho funciona.</p>
        <div class="acoes"><button class="btn primary" value="">Fechar</button></div>`);
    }
    const k = Pasta.chave(t);
    const atual = await Pasta.obter(k), geral = t ? await Pasta.obter('global') : null;
    const r = await dialogo(`<h2>Pasta de trabalho${t ? ' da turma' : ''}</h2>
      <p>${atual ? `Atual: <b>${esc(atual.name)}</b>` : t ? `A turma usa a pasta geral${geral ? `: <b>${esc(geral.name)}</b>` : ' (nenhuma escolhida)'}.` : 'Nenhuma pasta escolhida.'}</p>
      <p class="muted small">${t ? 'Exportações, backups e importações desta turma usam esta pasta; sem ela, vale a pasta geral.' : 'Exportações, backups e importações usam esta pasta (cada turma pode ter a sua, no menu da turma).'}
      O navegador pode pedir permissão para editar arquivos nela.</p>
      <div class="acoes">${atual ? '<button class="btn danger" value="esquecer">Esquecer</button>' : ''}
      <button class="btn" value="">Fechar</button><button class="btn primary" value="escolher">${atual ? 'Trocar pasta…' : 'Escolher pasta…'}</button></div>`);
    if (r.acao === 'esquecer') { await Pasta.esquecer(k); return toast('Pasta esquecida'); }
    if (r.acao !== 'escolher') return;
    try { const h = await Pasta.escolher(k); toast('Pasta de trabalho: ' + h.name); }
    catch (e) { if (e.name !== 'AbortError') toast('Não consegui usar a pasta: ' + e.message); }
  }

  /* ---------- arquivar turma ---------- */

  function alternarArquivo(t) {
    t.arquivada = t.arquivada ? null : CC.todayISO();
    salvar();
    toast(t.arquivada ? 'Turma arquivada (continua em "Turmas arquivadas")' : 'Turma restaurada');
    go('#/');
  }

  /* ---------- várias chamadas no mesmo dia ---------- */

  function outraChamada(t, aula) {
    const n = t.aulas.filter(a => a.data === aula.data).length;
    const nova = CC.aulaDaData(t, aula.data, n, true);
    salvar();
    toast(`${n + 1}ª chamada de ${CC.fmtDate(aula.data)} — cada chamada conta como uma aula`);
    go(`#/t/${t.id}/chamada/${nova.id}`);
  }

  function rotuloChamada(t, aula) {
    const doDia = CC.aulasOrdenadas(t).filter(a => a.data === aula.data);
    return doDia.length > 1 ? ` · ${doDia.indexOf(aula) + 1}ª chamada` : '';
  }

  /* ---------- tela: chamada ---------- */

  let modoUmAUm = false;
  let idxUmAUm = 0;

  function aulaPadrao(t) {
    const hoje = CC.todayISO();
    const aulas = CC.aulasOrdenadas(t).filter(a => a.tipo !== 'sem-aula');
    return aulas.find(a => a.data === hoje)
      || aulas.filter(a => a.data < hoje).pop()
      || aulas[0] || null;
  }

  function telaChamada(t, aulaId) {
    const aulas = CC.aulasOrdenadas(t).filter(a => a.tipo !== 'sem-aula');
    const aula = (aulaId && aulas.find(a => a.id === aulaId)) || aulaPadrao(t);
    const hoje = CC.todayISO();
    const temHoje = aulas.some(a => a.data === hoje);

    if (!t.alunos.length) {
      app.innerHTML = `<div class="card empty"><p>Esta turma ainda não tem alunos.</p>
        <a class="btn primary" href="#/t/${t.id}/alunos">Adicionar alunos</a></div>`;
      return;
    }
    if (!aula) {
      app.innerHTML = `<div class="card empty"><p>Nenhuma aula cadastrada.</p>
        <div class="stack"><button class="btn primary block" id="hoje">Fazer chamada de hoje (${CC.fmtDate(hoje, true)})</button>
        <a class="btn block" href="#/t/${t.id}/cronograma">Montar cronograma</a></div></div>`;
      $('#hoje').onclick = () => criarAulaHoje(t);
      return;
    }

    const i = aulas.indexOf(aula);
    const marc = t.presencas[aula.id] || {};
    const obs = t.obs[aula.id] || {};
    const alunos = CC.alunosOrdenados(t, false);
    const inativosMarcados = CC.alunosOrdenados(t, true).filter(a => !a.ativo && marc[a.id]);
    const c = CC.contarAula(t, aula);

    let h = `<div class="card">
      <div class="aula-nav">
        <button class="icon-btn" id="ant" ${i <= 0 ? 'disabled' : ''} aria-label="Aula anterior" style="color:var(--text)">&#8249;</button>
        <div class="info" id="info-aula" style="cursor:pointer">
          <div class="data">${CC.fmtDate(aula.data, true)}${aula.data === hoje ? ' · hoje' : ''}${rotuloChamada(t, aula)}</div>
          <div class="conteudo">${esc(aula.conteudo || 'Aula ' + (i + 1) + ' de ' + aulas.length)}</div>
        </div>
        <button class="icon-btn" id="prox" ${i >= aulas.length - 1 ? 'disabled' : ''} aria-label="Próxima aula" style="color:var(--text)">&#8250;</button>
      </div>
      <div class="contadores">
        <span class="c-P">${c.P} P</span><span class="c-A">${c.A} A</span><span class="c-J">${c.J} J</span><span class="c-F">${c.F} F</span><span class="c-vazio">${c.vazio} –</span>
      </div>
      <div class="row" style="margin-top:10px">
        <button class="btn small" id="modo">${modoUmAUm ? '☰ Lista' : '▶ Um a um'}</button>
        <button class="btn small" id="todos-p">Todos presentes</button><button class="btn small" id="todos-f">Todos ausentes</button>
        <button class="btn small" id="ler-folha" title="Ler a folha de presença assinada pelos alunos">📷 Ler folha</button>
        <button class="btn small" id="extra" title="Aula dupla, reposição ou segunda chamada no mesmo dia">+ Outra chamada neste dia</button>
        ${!temHoje ? `<button class="btn small right" id="hoje">+ Hoje</button>` : ''}
      </div></div>`;

    if (modoUmAUm) {
      if (idxUmAUm >= alunos.length) idxUmAUm = 0;
      const a = alunos[idxUmAUm];
      const v = marc[a.id];
      h += `<div class="card um-a-um">
        <div class="progresso">${idxUmAUm + 1} de ${alunos.length}</div>
        <div class="nome-grande">${esc(nomeCurto(a.nome))}</div>
        <div class="mat">${esc(a.matricula)}</div>
        <div class="small" style="margin-top:6px">${textoFaltas(t, a)}</div>
        <div class="grandes">
          ${['P', 'A', 'J', 'F'].map(s => `<button class="${s} ${v === s ? 'on' : ''}" data-um="${s}">${CC.STATUS_LABEL[s]}</button>`).join('')}
        </div>
        <div class="row" style="margin-top:16px;justify-content:space-between">
          <button class="btn" id="um-ant" ${idxUmAUm === 0 ? 'disabled' : ''}>‹ Anterior</button>
          <button class="btn" id="um-obs">${obs[a.id] ? '✎ Obs.' : '+ Obs.'}</button>
          <button class="btn" id="um-prox">Próximo ›</button>
        </div></div>`;
    } else {
      h += `<div class="card" style="padding:8px"><input type="search" id="busca" placeholder="Buscar aluno…" autocomplete="off"></div>
        <div class="lista-chamada" id="lista">` +
        alunos.concat(inativosMarcados).map(a => linhaChamada(t, a, marc[a.id], obs[a.id])).join('') + '</div>';
    }
    app.innerHTML = h;

    $('#ant').onclick = () => go(`#/t/${t.id}/chamada/${aulas[i - 1].id}`);
    $('#prox').onclick = () => go(`#/t/${t.id}/chamada/${aulas[i + 1].id}`);
    $('#info-aula').onclick = () => editarAula(t, aula);
    $('#modo').onclick = () => { modoUmAUm = !modoUmAUm; idxUmAUm = primeiroVazio(alunos, marc); render(); };
    const hb = $('#hoje'); if (hb) hb.onclick = () => criarAulaHoje(t);
    $('#extra').onclick = () => outraChamada(t, aula);
    $('#todos-p').onclick = () => marcarTodos(t, aula, 'P');
    $('#todos-f').onclick = () => marcarTodos(t, aula, 'F');
    $('#ler-folha').onclick = () => lerFolhaPresenca(t, aula);

    if (modoUmAUm) {
      const a = alunos[idxUmAUm];
      app.querySelectorAll('[data-um]').forEach(b => b.onclick = () => {
        marcar(t, aula, a.id, b.dataset.um, true);
        if (b.dataset.um === 'J' && !obs[a.id]) {
          editarObs(t, aula, a).then(() => { idxUmAUm = Math.min(idxUmAUm + 1, alunos.length - 1); render(); });
          return;
        }
        if (idxUmAUm < alunos.length - 1) idxUmAUm++;
        else toast('Fim da lista');
        render();
      });
      $('#um-ant').onclick = () => { idxUmAUm--; render(); };
      $('#um-prox').onclick = () => { idxUmAUm = Math.min(idxUmAUm + 1, alunos.length - 1); render(); };
      $('#um-obs').onclick = () => editarObs(t, aula, a).then(render);
    } else {
      const lista = $('#lista');
      lista.addEventListener('click', ev => {
        const b = ev.target.closest('[data-st]');
        if (b) {
          const row = b.closest('.aluno-row');
          const atual = (t.presencas[aula.id] || {})[row.dataset.id];
          const novo = atual === b.dataset.st ? null : b.dataset.st;
          marcar(t, aula, row.dataset.id, novo, false);
          const nova = atualizarLinha(t, aula, row);
          if (novo === 'J') {
            const a = t.alunos.find(x => x.id === nova.dataset.id);
            if (!(t.obs[aula.id] || {})[a.id]) editarObs(t, aula, a).then(() => atualizarLinha(t, aula, nova));
          }
          return;
        }
        const n = ev.target.closest('.nome');
        if (n) {
          const a = t.alunos.find(x => x.id === n.closest('.aluno-row').dataset.id);
          menuAlunoAula(t, aula, a, n.closest('.aluno-row'));
        }
      });
      $('#busca').addEventListener('input', ev => {
        const q = CC.norm(ev.target.value);
        lista.querySelectorAll('.aluno-row').forEach(r => { r.hidden = q && !r.dataset.busca.includes(q); });
      });
    }
  }

  function primeiroVazio(alunos, marc) {
    const k = alunos.findIndex(a => !marc[a.id]);
    return k < 0 ? 0 : k;
  }

  /** "3 faltas" colorido: vermelho acima do limite, laranja perto dele. */
  function textoFaltas(t, a) {
    const st = CC.statsAluno(t, a);
    const cod = st.situacao.cod === 'RF' || st.situacao.cod === 'LIM' ? st.situacao.cod : '';
    return `<span class="faltas-n ${cod}" title="${esc(st.situacao.texto || 'Faltas até agora')}">${CC.numBR(st.faltas, st.faltas % 1 ? 1 : 0)} falta${st.faltas === 1 ? '' : 's'}</span>`;
  }

  function linhaChamada(t, a, v, obs) {
    return `<div class="aluno-row ${a.ativo ? '' : 'inativo'}" data-id="${a.id}" data-busca="${esc(CC.norm(a.nome + ' ' + a.matricula))}">
      <div class="nome">${esc(nomeCurto(a.nome))}${obs ? ' <span class="obs-dot" title="Observação">●</span>' : ''}
        <div class="det">${textoFaltas(t, a)} · ${esc(a.matricula)}${cursoDe(a) ? ' · ' + esc(cursoDe(a)) : ''}${a.ativo ? '' : ' · fora da lista'}</div></div>
      <div class="st-group">${['P', 'A', 'J', 'F'].map(s => `<button class="st ${s} ${v === s ? 'on' : ''}" data-st="${s}" aria-label="${CC.STATUS_LABEL[s]}">${s}</button>`).join('')}</div>
    </div>`;
  }

  function atualizarLinha(t, aula, row) {
    const a = t.alunos.find(x => x.id === row.dataset.id);
    const tmp = document.createElement('div');
    tmp.innerHTML = linhaChamada(t, a, (t.presencas[aula.id] || {})[a.id], (t.obs[aula.id] || {})[a.id]);
    const nova = tmp.firstElementChild;
    nova.hidden = row.hidden;
    row.replaceWith(nova);
    atualizarContadores(t, aula);
    return nova;
  }

  function atualizarContadores(t, aula) {
    const c = CC.contarAula(t, aula);
    const el = app.querySelector('.contadores');
    if (el) el.innerHTML = `<span class="c-P">${c.P} P</span><span class="c-A">${c.A} A</span><span class="c-J">${c.J} J</span><span class="c-F">${c.F} F</span><span class="c-vazio">${c.vazio} –</span>`;
  }

  function marcar(t, aula, alunoId, status) {
    const m = t.presencas[aula.id] || (t.presencas[aula.id] = {});
    if (status) m[alunoId] = status; else delete m[alunoId];
    if (navigator.vibrate) navigator.vibrate(12);
    salvar();
  }

  /** Marca todos os inscritos; se já houver outras marcações, pergunta se sobrescreve. */
  async function marcarTodos(t, aula, status) {
    const m = t.presencas[aula.id] || (t.presencas[aula.id] = {});
    const ativos = t.alunos.filter(a => a.ativo);
    const vazios = ativos.filter(a => !m[a.id]);
    const outros = ativos.filter(a => m[a.id] && m[a.id] !== status);
    const rotulo = status === 'P' ? 'presentes' : 'ausentes (falta)';
    let alvo = ativos;
    if (outros.length) {
      const r = await dialogo(`<h2>Marcar todos como ${rotulo}</h2>
        <p>${outros.length} aluno(s) já têm outra marcação nesta aula${vazios.length ? ` e ${vazios.length} ainda não foram marcados` : ''}.</p>
        <div class="acoes"><button class="btn" value="">Cancelar</button>
        ${vazios.length ? '<button class="btn" value="vazios">Só os não marcados</button>' : ''}
        <button class="btn primary" value="todos">Todos (sobrescrever)</button></div>`);
      if (r.acao === 'vazios') alvo = vazios;
      else if (r.acao !== 'todos') return;
    }
    alvo.forEach(a => { m[a.id] = status; });
    salvar(); render();
    toast(`${alvo.length} marcado(s) como ${rotulo}`);
  }

  function criarAulaHoje(t) {
    const aula = CC.aulaDaData(t, CC.todayISO(), 0, true);
    salvar();
    go(`#/t/${t.id}/chamada/${aula.id}`);
  }

  async function editarObs(t, aula, a) {
    const atual = (t.obs[aula.id] || {})[a.id] || '';
    const r = await dialogo(`<h2>Observação</h2><p class="muted">${esc(nomeCurto(a.nome))} · ${CC.fmtDate(aula.data, true)}</p>
      <textarea name="obs" autofocus placeholder="ex.: atestado médico">${esc(atual)}</textarea>
      <div class="acoes"><button class="btn" value="">Cancelar</button><button class="btn primary" value="ok">Salvar</button></div>`);
    if (r.acao !== 'ok') return;
    const m = t.obs[aula.id] || (t.obs[aula.id] = {});
    const txt = String(r.dados.obs || '').trim();
    if (txt) m[a.id] = txt; else delete m[a.id];
    salvar();
  }

  async function menuAlunoAula(t, aula, a, row) {
    const obs = (t.obs[aula.id] || {})[a.id];
    const st = CC.statsAluno(t, a);
    const r = await dialogo(`<h2>${esc(nomeCurto(a.nome))}</h2>
      <p class="muted small">${esc(a.matricula)} · ${CC.numBR(st.faltas)} falta(s) de ${limTxt(t)} permitidas${st.situacao.cod === 'RF' ? ' · <b style="color:var(--F)">reprovado por falta</b>' : ''}</p>
      ${obs ? `<p>Obs. (${CC.fmtDate(aula.data)}): ${esc(obs)}</p>` : ''}
      <ul class="menu-list">
      <li><button value="obs">${obs ? 'Editar' : 'Adicionar'} observação desta aula</button></li>
      <li><button value="hist">Ver histórico do aluno</button></li></ul>
      <div class="acoes"><button class="btn" value="">Fechar</button></div>`);
    if (r.acao === 'obs') { await editarObs(t, aula, a); atualizarLinha(t, aula, row); }
    if (r.acao === 'hist') go(`#/t/${t.id}/aluno/${a.id}`);
  }

  /* ---------- tela: alunos ---------- */

  function telaAlunos(t) {
    const todos = CC.alunosOrdenados(t, true);
    const ativos = todos.filter(a => a.ativo).length;
    const v = Object.assign({}, visaoDe(t), { inativos: true });
    const lista = CC.alunosVisao(t, v, cursoDe);
    let h = `<div class="card"><div class="row"><div class="grow">
      <b>${ativos}</b> inscritos${todos.length > ativos ? ` · <span class="muted">${todos.length - ativos} fora da lista</span>` : ''}
      <div class="muted small">${t.listaEm ? 'Lista oficial atualizada em ' + CC.fmtDate(t.listaEm) : 'Lista oficial ainda não importada'}</div>
      <div class="muted small">${resumoCursos(todos.filter(a => a.ativo))}</div></div>
      <button class="btn small" id="atualizar">Atualizar lista</button></div></div>`;
    if (!todos.length) {
      h += `<div class="card empty">Sem alunos. Importe a lista do sistema ou adicione à mão.</div>`;
    } else {
      h += barraVisao(t, todos.length, lista);
      h += `<div class="lista-chamada">` + (lista.length ? lista.map(({ a, st }) => `<div class="aluno-row ${a.ativo ? '' : 'inativo'}" data-id="${a.id}">
          <div class="nome">${esc(nomeCurto(a.nome))}
          <div class="det">${esc(a.matricula || 'sem matrícula')}${cursoDe(a) ? ' · ' + esc(cursoDe(a)) : ''}${a.ativo ? '' : ' · fora da lista' + (a.saiuEm ? ' (' + esc(a.saiuEm.includes('-') ? CC.fmtDate(a.saiuEm) : a.saiuEm) + ')' : '')}${a.origem === 'manual' ? ' · incluído à mão' : ''}</div></div>
          <div class="right small num">${CC.numBR(st.faltas)} F${st.media != null ? ' · ' + CC.numBR(st.mf != null ? st.mf : st.media) : ''}${st.sitNota.cod ? ` <span class="tag ${st.sitNota.cod}">${{ RF: 'RF', OK: 'OK', VS: 'VS', BAIXA: '↓' }[st.sitNota.cod]}</span>` : ''}</div></div>`).join('')
        : '<div class="empty">Nenhum aluno neste filtro.</div>') + '</div>';
    }
    h += `<button class="fab" id="add">+ Aluno</button>`;
    app.innerHTML = h;
    $('#atualizar').onclick = () => atualizarLista(t);
    $('#add').onclick = () => editarAluno(t, null);
    if (todos.length) ligarBarraVisao(t, lista.filter(x => x.a.ativo));
    app.querySelectorAll('.aluno-row').forEach(r => r.onclick = () => go(`#/t/${t.id}/aluno/${r.dataset.id}`));
  }

  async function editarAluno(t, a) {
    const novo = !a;
    a = a || { nome: '', matricula: '', email: '', cpf: '' };
    const r = await dialogo(`<h2>${novo ? 'Novo aluno' : 'Editar aluno'}</h2><div class="stack">
      <label class="field">Nome<input type="text" name="nome" value="${esc(a.nome)}" required autofocus></label>
      <label class="field">Matrícula<input type="text" name="matricula" inputmode="numeric" value="${esc(a.matricula)}"></label>
      <label class="field">E-mail<input type="text" name="email" inputmode="email" value="${esc(a.email)}"></label>
      ${novo ? '' : `<label class="checks"><label><input type="checkbox" name="ativo" ${a.ativo ? 'checked' : ''}> inscrito (aparece na chamada)</label></label>`}
      </div>
      <div class="acoes">${novo ? '' : '<button class="btn danger" value="remover" formnovalidate>Remover</button>'}
      <button class="btn" value="" formnovalidate>Cancelar</button><button class="btn primary" value="ok">Salvar</button></div>`);
    if (r.acao === 'remover') {
      const ok = await confirmar('Remover aluno', `Remover <b>${esc(a.nome)}</b> e todo o histórico de presença e notas? Para só tirá-lo da chamada, desmarque "inscrito".`, 'Remover', true);
      if (ok) { CC.removerAluno(t, a.id); salvar(); go(`#/t/${t.id}/alunos`); }
      return;
    }
    if (r.acao !== 'ok') return;
    const nome = r.dados.nome.trim();
    if (!nome) return;
    const mat = r.dados.matricula.trim();
    if (mat && t.alunos.some(x => x !== a && x.matricula === mat)) return toast('Já existe aluno com essa matrícula');
    if (novo) {
      t.alunos.push({ id: CC.uid('a'), nome, matricula: mat, email: r.dados.email.trim(), cpf: '', origem: 'manual', ativo: true, entrouEm: CC.todayISO(), saiuEm: null });
    } else {
      a.nome = nome; a.matricula = mat; a.email = r.dados.email.trim();
      const ativo = !!r.dados.ativo;
      if (a.ativo && !ativo) a.saiuEm = CC.todayISO();
      if (ativo) a.saiuEm = null;
      a.ativo = ativo;
    }
    salvar(); render();
  }

  function telaAluno(t, alunoId) {
    const a = t.alunos.find(x => x.id === alunoId);
    if (!a) return go(`#/t/${t.id}/alunos`);
    const st = CC.statsAluno(t, a);
    const aulas = CC.aulasOrdenadas(t).filter(x => CC.aulaRealizada(t, x));
    let h = `<div class="card"><div class="row nowrap"><div class="grow">
      <h2>${esc(nomeCurto(a.nome))}</h2>
      <div class="muted small">${esc(a.matricula)}${a.email ? ' · ' + esc(a.email) : ''}</div>
      ${(i => i ? `<div class="small">${esc(i.curso)} <span class="muted">· ingresso ${esc(i.ingresso)}</span></div>` : '')(CC.infoMatricula(a.matricula, cursos()))}
      ${a.ativo ? '' : '<span class="tag fora">fora da lista</span>'}</div>
      <div class="stack" style="flex:none"><button class="btn small" id="editar">Editar</button>${a.email ? '<button class="btn small" id="mail-aluno">✉ E-mail</button>' : ''}</div></div>
      <div class="contadores"><span class="c-P">${st.P} P</span><span class="c-A">${st.A} A</span><span class="c-J">${st.J} J</span><span class="c-F">${st.F} F</span></div>
      <p class="small" style="margin:10px 0 0">Faltas: <b>${CC.numBR(st.faltas)}</b> de ${limTxt(t)} permitidas
      ${st.freq != null ? ' · frequência ' + Math.round(st.freq * 100) + '%' : ''}
      ${st.media != null ? ' · média ' + CC.numBR(st.media) : ''}${CC.avaliacaoTipo(t, 'VS') && st.mf != null && st.mf !== st.media ? ' · MF ' + CC.numBR(st.mf) : ''}
      ${st.situacao.texto ? ` <span class="tag ${st.situacao.cod}">${st.situacao.texto}</span>` : ''}</p></div>`;
    if (t.avaliacoes.length) {
      h += `<div class="card"><h3>Notas</h3>` + t.avaliacoes.map(v => {
        const n = (t.notas[v.id] || {})[a.id];
        return `<div class="row small"><span class="grow">${esc(v.nome)}</span><b>${typeof n === 'number' ? CC.numBR(n, n % 1 ? 1 : 0) : '—'}</b><span class="muted">/ ${v.max}</span></div>`;
      }).join('') + '</div>';
    }
    h += `<div class="lista-chamada">` + (aulas.length ? aulas.map(aula => {
      const v = (t.presencas[aula.id] || {})[a.id];
      const o = (t.obs[aula.id] || {})[a.id];
      return `<div class="aula-item" data-aula="${aula.id}"><div class="quando">${CC.fmtDate(aula.data)}<div class="dia">${CC.DIAS[CC.weekday(aula.data)]}${rotuloChamada(t, aula).replace(' · ', ' · ').replace(' chamada', '')}</div></div>
        <div class="grow small">${esc(aula.conteudo || '')}${o ? `<div class="muted">Obs.: ${esc(o)}</div>` : ''}</div>
        ${v ? `<span class="mini ${v}">${v}</span>` : '<span class="mini">–</span>'}</div>`;
    }).join('') : '<div class="empty">Nenhuma chamada feita ainda.</div>') + '</div>';
    app.innerHTML = h;
    setTopo(nomeCurto(a.nome), CC.nomeTurma(t), `#/t/${t.id}/alunos`, () => menuTurma(t));
    $('#editar').onclick = () => editarAluno(t, a);
    const ma = $('#mail-aluno'); if (ma) ma.onclick = () => enviarEmail(t, [a]);
    app.querySelectorAll('[data-aula]').forEach(el => el.onclick = () => go(`#/t/${t.id}/chamada/${el.dataset.aula}`));
  }

  /* ---------- tela: cronograma ---------- */

  function telaCronograma(t) {
    const aulas = CC.aulasOrdenadas(t);
    const hoje = CC.todayISO();
    let h = `<div class="card"><div class="row"><div class="grow"><b>${CC.aulasPrevistas(t)}</b> aulas previstas
      <div class="muted small">${aulas.filter(a => CC.aulaRealizada(t, a)).length} com chamada · máximo de ${limTxt(t)} faltas</div></div>
      <button class="btn small" id="gerar">Gerar datas</button></div></div>`;
    h += `<div class="lista-chamada">` + (aulas.length ? aulas.map(aula => {
      const feita = CC.aulaRealizada(t, aula);
      const c = feita ? CC.contarAula(t, aula) : null;
      return `<div class="aula-item ${aula.data === hoje ? 'hoje' : ''} ${aula.tipo}" data-id="${aula.id}">
        <div class="quando">${CC.fmtDate(aula.data)}<div class="dia">${CC.DIAS[CC.weekday(aula.data)]}${rotuloChamada(t, aula).replace(' · ', ' · ').replace(' chamada', '')}</div></div>
        <div class="grow"><div>${esc(aula.conteudo || (aula.tipo === 'aula' ? '' : CC.TIPOS[aula.tipo]))}</div>
        <div class="badge">${aula.tipo !== 'aula' ? CC.TIPOS[aula.tipo] : ''}${feita ? (aula.tipo !== 'aula' ? ' · ' : '') + c.P + ' P · ' + c.A + ' A · ' + c.J + ' J · ' + c.F + ' F' : ''}</div></div>
        ${aula.tipo !== 'sem-aula' ? `<button class="btn small" data-chamada="${aula.id}">${feita ? 'Ver' : 'Chamada'}</button>` : ''}</div>`;
    }).join('') : '<div class="empty">Nenhuma aula. Use "Gerar datas" ou adicione uma por uma.</div>') + '</div>';
    h += `<button class="fab" id="add">+ Aula</button>`;
    app.innerHTML = h;
    $('#gerar').onclick = () => gerarDatas(t);
    $('#add').onclick = () => editarAula(t, null);
    app.querySelectorAll('.aula-item').forEach(el => el.onclick = ev => {
      const b = ev.target.closest('[data-chamada]');
      if (b) return go(`#/t/${t.id}/chamada/${b.dataset.chamada}`);
      editarAula(t, t.aulas.find(a => a.id === el.dataset.id));
    });
  }

  async function gerarDatas(t) {
    const aulas = CC.aulasOrdenadas(t);
    const c = t.config;
    const ini = c.inicio || (aulas.length ? aulas[0].data : CC.todayISO());
    const fim = c.fim || (aulas.length ? aulas[aulas.length - 1].data : CC.addDays(CC.todayISO(), 120));
    const diasUsados = new Set(c.dias && c.dias.length ? c.dias : aulas.map(a => CC.weekday(a.data)));
    const r = await dialogo(`<h2>Gerar datas de aula</h2><div class="stack">
      <div class="row nowrap"><label class="field grow">De<input type="date" name="ini" value="${ini}" required></label>
      <label class="field grow">Até<input type="date" name="fim" value="${fim}" required></label></div>
      <div class="checks">${[1, 2, 3, 4, 5, 6].map(d => `<label><input type="checkbox" name="dia" value="${d}" ${diasUsados.has(d) ? 'checked' : ''}> ${CC.DIAS[d]}</label>`).join('')}</div>
      <p class="muted small">Datas que já existem não são duplicadas. Depois marque feriados como "Sem aula".</p></div>
      <div class="acoes"><button class="btn" value="" formnovalidate>Cancelar</button><button class="btn primary" value="ok">Gerar</button></div>`);
    if (r.acao !== 'ok') return;
    const dias = [].concat(r.dados.dia || []).map(Number);
    if (!dias.length) return toast('Escolha ao menos um dia da semana');
    const n = CC.gerarCronograma(t, r.dados.ini, r.dados.fim, dias);
    Object.assign(c, { inicio: r.dados.ini, fim: r.dados.fim, dias });
    salvar(); render();
    toast(n + ' aula(s) adicionada(s)');
  }

  async function editarAula(t, aula) {
    const nova = !aula;
    const a = aula || { data: CC.todayISO(), conteudo: '', tipo: 'aula' };
    const r = await dialogo(`<h2>${nova ? 'Nova aula' : 'Aula'}</h2><div class="stack">
      <label class="field">Data<input type="date" name="data" value="${a.data}" required></label>
      <label class="field">Tipo<select name="tipo">${Object.keys(CC.TIPOS).map(k => `<option value="${k}" ${a.tipo === k ? 'selected' : ''}>${CC.TIPOS[k]}</option>`).join('')}</select></label>
      <label class="field">Conteúdo / observação<input type="text" name="conteudo" value="${esc(a.conteudo)}" placeholder="ex.: Autômatos finitos; Feriado; P1"></label>
      </div>
      <div class="acoes">${nova ? '' : '<button class="btn danger" value="remover" formnovalidate>Excluir</button><button class="btn" value="presenca" formnovalidate>Lista de presença</button>'}
      <button class="btn" value="" formnovalidate>Cancelar</button><button class="btn primary" value="ok">Salvar</button></div>`);
    if (r.acao === 'presenca') return exportar(t, aula);
    if (r.acao === 'remover') {
      const temChamada = CC.aulaRealizada(t, aula);
      const ok = !temChamada || await confirmar('Excluir aula', `A aula de ${CC.fmtDate(aula.data)} tem chamada registrada. Excluir mesmo assim?`, 'Excluir', true);
      if (ok) { CC.removerAula(t, aula.id); salvar(); render(); }
      return;
    }
    if (r.acao !== 'ok' || !r.dados.data) return;
    if (nova) {
      const doDia = t.aulas.filter(x => x.data === r.dados.data).length;
      t.aulas.push({ id: CC.uid('d'), data: r.dados.data, conteudo: r.dados.conteudo.trim(), tipo: r.dados.tipo, ordem: doDia });
    } else {
      aula.data = r.dados.data;
      aula.tipo = r.dados.tipo;
      aula.conteudo = r.dados.conteudo.trim();
    }
    salvar(); render();
  }

  /* ---------- tela: notas ---------- */

  function telaNotas(t, avId) {
    const avs = t.avaliacoes;
    let listaNotas = null;
    const vs = CC.avaliacaoTipo(t, 'VS'), vr = CC.avaliacaoTipo(t, 'VR');
    let h = `<div class="card"><div class="row"><div class="grow"><b>Avaliações</b>
      <div class="muted small">Média = soma(peso × nota ÷ máx. × 10) ÷ soma dos pesos${vr ? ' · VR substitui a prova perdida' : ''}${vs ? ` · média entre ${CC.numBR(t.config.mediaVS)} e ${CC.numBR(t.config.mediaMin)} faz VS` : ''}</div></div>
      <button class="btn small" id="plano">Plano de avaliação</button></div>`;
    if (avs.length) {
      h += `<div class="checks" style="margin-top:10px">` + avs.map(v => {
        const normal = !v.tipo || v.tipo === 'normal';
        const det = [v.data ? CC.fmtDate(v.data).slice(0, 5) : '', normal ? '×' + CC.numBR(v.peso, v.peso % 1 ? 1 : 0) : ''].filter(Boolean).join(' · ');
        return `<a class="btn small ${v.id === avId ? 'primary' : ''}" href="#/t/${t.id}/notas/${v.id}">${esc(v.nome)}${det ? ` <span class="small" style="opacity:.7">${det}</span>` : ''}</a>`;
      }).join('') + '</div>';
    }
    h += '</div>';
    const av = avs.find(v => v.id === avId);
    if (av) {
      const notas = t.notas[av.id] || {};
      h += `<div class="card"><div class="row"><div class="grow"><h3>${esc(av.nome)}</h3>
        <div class="muted small">nota de 0 a ${av.max}${av.data ? ' · ' + CC.fmtDate(av.data, true) : ''} · ${av.tipo === 'VR' ? 'substitui a prova perdida' : av.tipo === 'VS' ? 'suplementar' : 'peso ' + CC.numBR(av.peso, av.peso % 1 ? 1 : 0)}</div></div>
        <button class="btn small" id="edit-av">Editar</button></div></div>
        <div class="lista-chamada">` + CC.alunosOrdenados(t, false).map(a => {
        const n = notas[a.id];
        return `<div class="aluno-row"><div class="nome">${esc(nomeCurto(a.nome))}<div class="det">${esc(a.matricula)}</div></div>
          <input type="text" inputmode="decimal" class="nota-input" data-aluno="${a.id}" value="${typeof n === 'number' ? String(n).replace('.', ',') : ''}" enterkeyhint="next"></div>`;
      }).join('') + '</div>';
    } else if (avs.length) {
      const lista = CC.alunosVisao(t, visaoDe(t), cursoDe);
      h += cartaoEstatisticas(t) + barraVisao(t, CC.alunosOrdenados(t, false).length, lista) + tabelaNotas(t, lista);
      listaNotas = lista;
    } else {
      h += `<div class="card empty">Defina o plano de avaliação (quantas provas, datas e pesos) para lançar as notas.</div>`;
    }
    app.innerHTML = h;
    $('#plano').onclick = () => editarPlano(t);
    if (listaNotas) {
      ligarBarraVisao(t, listaNotas);
      app.querySelectorAll('tr[data-id]').forEach(tr => tr.onclick = () => go(`#/t/${t.id}/aluno/${tr.dataset.id}`));
    }
    if (av) {
      $('#edit-av').onclick = () => editarAvaliacao(t, av);
      const inputs = Array.from(app.querySelectorAll('.nota-input'));
      inputs.forEach((inp, k) => {
        inp.addEventListener('change', () => {
          const m = t.notas[av.id] || (t.notas[av.id] = {});
          const txt = inp.value.trim().replace(',', '.');
          if (!txt) { delete m[inp.dataset.aluno]; salvar(); return; }
          const v = parseFloat(txt);
          if (isNaN(v) || v < 0 || v > av.max) { toast(`Nota inválida (0 a ${av.max})`); inp.value = ''; delete m[inp.dataset.aluno]; }
          else m[inp.dataset.aluno] = v;
          salvar();
        });
        inp.addEventListener('keydown', ev => {
          if (ev.key === 'Enter') { ev.preventDefault(); (inputs[k + 1] || inp).focus(); if (!inputs[k + 1]) inp.blur(); }
        });
      });
    }
  }

  function tabelaNotas(t, lista) {
    const avs = t.avaliacoes;
    const vs = CC.avaliacaoTipo(t, 'VS');
    return `<div class="tabela-wrap"><table><thead><tr><th>Aluno</th>${avs.map(v => `<th class="num">${esc(v.nome)}</th>`).join('')}<th class="num">${vs ? 'MP' : 'Média'}</th>${vs ? '<th class="num">MF</th>' : ''}<th>Situação</th></tr></thead><tbody>` +
      lista.map(({ a, st }) => {
        return `<tr data-id="${a.id}" style="cursor:pointer"><td class="nome-cel">${esc(nomeCurto(a.nome))}</td>${avs.map(v => {
          const n = (t.notas[v.id] || {})[a.id];
          return `<td class="num">${typeof n === 'number' ? CC.numBR(n, n % 1 ? 1 : 0) : ''}</td>`;
        }).join('')}<td class="num"><b>${st.media != null ? CC.numBR(st.media) : ''}</b></td>
        ${vs ? `<td class="num"><b>${st.mf != null ? CC.numBR(st.mf) : ''}</b></td>` : ''}
        <td>${st.situacao.texto ? `<span class="tag ${st.situacao.cod}">${st.situacao.texto}</span>` : ''}</td></tr>`;
      }).join('') + '</tbody></table></div>';
  }

  async function editarAvaliacao(t, av) {
    const nova = !av;
    const v = av || { nome: '', tipo: 'normal', data: '', peso: 1, max: 10 };
    const r = await dialogo(`<h2>${nova ? 'Nova avaliação' : 'Avaliação'}</h2><div class="stack">
      <label class="field">Nome<input type="text" name="nome" value="${esc(v.nome)}" required autofocus placeholder="ex.: P1"></label>
      <div class="row nowrap"><label class="field grow">Tipo<select name="tipo">${Object.keys(CC.TIPOS_AVALIACAO).map(k => `<option value="${k}" ${(v.tipo || 'normal') === k ? 'selected' : ''}>${CC.TIPOS_AVALIACAO[k]}</option>`).join('')}</select></label>
      <label class="field grow">Data<input type="date" name="data" value="${esc(v.data || '')}"></label></div>
      <div class="row nowrap"><label class="field grow">Peso (só para "entra na média")<input type="text" inputmode="decimal" name="peso" value="${String(v.peso).replace('.', ',')}"></label>
      <label class="field grow">Nota máxima<input type="text" inputmode="decimal" name="max" value="${String(v.max).replace('.', ',')}"></label></div></div>
      <div class="acoes">${nova ? '' : '<button class="btn danger" value="remover" formnovalidate>Excluir</button>'}
      <button class="btn" value="" formnovalidate>Cancelar</button><button class="btn primary" value="ok">Salvar</button></div>`);
    if (r.acao === 'remover') {
      const ok = await confirmar('Excluir avaliação', `Excluir <b>${esc(av.nome)}</b> e todas as notas lançadas nela?`, 'Excluir', true);
      if (ok) {
        t.avaliacoes = t.avaliacoes.filter(x => x.id !== av.id);
        delete t.notas[av.id];
        salvar(); go(`#/t/${t.id}/notas`);
      }
      return;
    }
    if (r.acao !== 'ok') return;
    const num = s => parseFloat(String(s).replace(',', '.'));
    const tipo = r.dados.tipo || 'normal';
    const dados = { nome: r.dados.nome.trim(), tipo, data: r.dados.data || '', peso: tipo === 'normal' ? num(r.dados.peso) : 0, max: num(r.dados.max) };
    if (!dados.nome || isNaN(dados.peso) || !(dados.max > 0)) return toast('Preencha nome, peso e nota máxima');
    if (tipo !== 'normal' && t.avaliacoes.some(x => x !== av && x.tipo === tipo)) return toast('Já existe uma ' + tipo + ' no plano');
    if (nova) {
      const nv = Object.assign({ id: CC.uid('v') }, dados);
      t.avaliacoes.push(nv);
      CC.sincronizarAvaliacoes(t);
      salvar(); go(`#/t/${t.id}/notas/${nv.id}`);
    } else {
      Object.assign(av, dados);
      CC.sincronizarAvaliacoes(t);
      salvar(); render();
    }
  }

  /* ---------- tela: resumo ---------- */

  function telaResumo(t) {
    const todos = CC.alunosOrdenados(t, false);
    const temNotas = t.avaliacoes.length > 0;
    const temVS = !!CC.avaliacaoTipo(t, 'VS');
    const stats = CC.alunosVisao(t, visaoDe(t), cursoDe);
    const todosStats = todos.map(a => CC.statsAluno(t, a));
    const rf = todosStats.filter(s => s.situacao.cod === 'RF').length;
    const lim = todosStats.filter(s => s.situacao.cod === 'LIM').length;
    const dadas = t.aulas.filter(a => CC.aulaRealizada(t, a)).length;
    let h = `<div class="card"><div class="row"><div class="grow">
      <b>${dadas}</b> de ${CC.aulasPrevistas(t)} aulas com chamada · máximo de <b>${limTxt(t)}</b> faltas
      <div class="muted small">${rf} reprovado(s) por falta · ${lim} perto do limite · atraso vale ${CC.numBR(t.config.pesoAtraso, 2)} falta</div>
      ${!(t.config.cargaHoraria > 0) ? `<div class="small" style="color:var(--A);margin-top:6px">Sem carga horária: o limite usa só as aulas do cronograma. Informe a carga nas configurações da turma.</div>` : ''}</div>
      <button class="btn small primary" id="exportar">Exportar .xlsx</button></div></div>`;
    h += barraVisao(t, todos.length, stats);
    h += `<div class="tabela-wrap"><table><thead><tr><th>Aluno</th><th class="num">P</th><th class="num">A</th><th class="num">J</th><th class="num">F</th><th class="num">Faltas</th><th class="num">Freq.</th>${temNotas ? `<th class="num">${temVS ? 'MP' : 'Média'}</th>` : ''}${temVS ? '<th class="num">MF</th>' : ''}<th>Situação</th></tr></thead><tbody>` +
      (stats.length ? stats.map(({ a, st }) => `<tr data-id="${a.id}" style="cursor:pointer"><td class="nome-cel">${esc(nomeCurto(a.nome))}</td>
        <td class="num">${st.P}</td><td class="num">${st.A}</td><td class="num">${st.J}</td><td class="num">${st.F}</td>
        <td class="num"><b>${CC.numBR(st.faltas)}</b></td><td class="num">${st.freq != null ? Math.round(st.freq * 100) + '%' : ''}</td>
        ${temNotas ? `<td class="num">${st.media != null ? CC.numBR(st.media) : ''}</td>` : ''}${temVS ? `<td class="num">${st.mf != null ? CC.numBR(st.mf) : ''}</td>` : ''}
        <td>${st.situacao.texto ? `<span class="tag ${st.situacao.cod}">${st.situacao.texto}</span>` : ''}</td></tr>`).join('')
        : `<tr><td colspan="10" class="empty">Nenhum aluno neste filtro.</td></tr>`) +
      '</tbody></table></div>';
    app.innerHTML = h;
    $('#exportar').onclick = () => exportar(t, null);
    ligarBarraVisao(t, stats);
    app.querySelectorAll('tr[data-id]').forEach(tr => tr.onclick = () => go(`#/t/${t.id}/aluno/${tr.dataset.id}`));
  }

  /* ---------- início ---------- */

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW', e));
  }
  // Ganchos para depuração no console.
  window.__cc = { get db() { return db; }, salvar, render, cursos };
  render();
})();
