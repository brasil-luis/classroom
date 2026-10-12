/* ClassroomControl — leitura de folhas de presença por foto, 100% no aparelho (Tesseract.js).
 *
 * Dois tipos de folha:
 *  - "impressa": a Lista de presença exportada pelo app. Os nomes/matrículas impressos são
 *    lidos com segurança; presença = há tinta (assinatura) na linha, depois do texto impresso.
 *  - "à mão": folha em branco onde cada aluno escreveu nome e/ou matrícula. A leitura de letra
 *    de mão é imperfeita, então cada linha é casada com o aluno mais parecido da turma e tudo
 *    passa por uma tela de conferência.
 * A biblioteca e o modelo de português são baixados na primeira vez e ficam em cache. */
(function (g) {
  'use strict';
  const CC = g.CC;
  const TESSERACT = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
  const IDIOMA = 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/por@1.0.0/4.0.0_best_int';
  const LADO_MAX = 2000;
  // Tinta mínima (em "quadrados da altura da linha") para considerar que houve assinatura.
  const LIMIAR_TINTA = 0.06;

  function carregarScript(src) {
    return new Promise((ok, erro) => {
      if (document.querySelector(`script[src="${src}"]`)) return ok();
      const s = document.createElement('script');
      s.src = src; s.onload = ok;
      s.onerror = () => erro(new Error('não consegui baixar o leitor de texto (é preciso internet na primeira vez)'));
      document.head.appendChild(s);
    });
  }

  /** Foto → canvas em tons de cinza, no máximo LADO_MAX px. O canal vermelho pesa mais:
   *  a pauta azul-clara some e a tinta azul ou preta continua escura. */
  async function prepararImagem(file) {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const esc = Math.min(1, LADO_MAX / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * esc), h = Math.round(bmp.height * esc);
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0, w, h);
    const img = ctx.getImageData(0, 0, w, h), px = img.data;
    const cinza = new Uint8ClampedArray(w * h);
    for (let i = 0, k = 0; i < px.length; i += 4, k++) cinza[k] = 0.6 * px[i] + 0.3 * px[i + 1] + 0.1 * px[i + 2];
    // Contraste: estica entre os percentis 2% e 98%.
    const hist = new Uint32Array(256);
    cinza.forEach(v => hist[v]++);
    const perc = p => { let acc = 0; for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= p * cinza.length) return v; } return 255; };
    const lo = perc(0.02), hi = Math.max(perc(0.98), lo + 1);
    for (let i = 0, k = 0; i < px.length; i += 4, k++) {
      const v = Math.max(0, Math.min(255, (cinza[k] - lo) * 255 / (hi - lo)));
      cinza[k] = v; px[i] = px[i + 1] = px[i + 2] = v;
    }
    ctx.putImageData(img, 0, 0);
    return { canvas: cv, cinza, w, h };
  }

  let workerPromessa = null;
  function obterWorker(progresso) {
    if (!workerPromessa) {
      workerPromessa = carregarScript(TESSERACT).then(() => g.Tesseract.createWorker('por', 1, {
        langPath: IDIOMA,
        logger: m => { if (progresso && m.status) progresso(m.status, m.progress || 0); }
      }));
      workerPromessa.catch(() => { workerPromessa = null; });
    }
    return workerPromessa;
  }

  /** Tinta "fora do texto impresso" numa faixa: ignora linhas retas da grade. */
  function tintaNaFaixa(img, x0, y0, x1, y1) {
    const { cinza, w } = img;
    x0 = Math.max(0, Math.round(x0)); x1 = Math.min(img.w, Math.round(x1));
    y0 = Math.max(0, Math.round(y0)); y1 = Math.min(img.h, Math.round(y1));
    const bw = x1 - x0, bh = y1 - y0;
    if (bw < 10 || bh < 5) return 0;
    const escuro = v => v < 110;
    const col = new Uint16Array(bw), lin = new Uint16Array(bh);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      if (escuro(cinza[y * w + x])) { col[x - x0]++; lin[y - y0]++; }
    }
    let total = 0;
    for (let y = y0; y < y1; y++) {
      if (lin[y - y0] > bw * 0.35) continue;          // linha horizontal da grade (ou borda do cabeçalho)
      for (let x = x0; x < x1; x++) {
        if (col[x - x0] > bh * 0.6) continue;          // linha vertical da grade
        if (!escuro(cinza[y * w + x])) continue;
        // Área cheia (fundo do cabeçalho, sombra) não é traço de assinatura.
        const d = 4, i = y * w + x;
        if (y >= d && y + d < img.h && x >= d && x + d < w &&
            escuro(cinza[i - d * w]) && escuro(cinza[i + d * w]) && escuro(cinza[i - d]) && escuro(cinza[i + d])) continue;
        total++;
      }
    }
    return total / (bh * bh);                          // ~ "quantos quadrados da altura da linha" de tinta
  }

  function recorte(img, x0, y0, x1, y1, largura) {
    x0 = Math.max(0, Math.round(x0)); y0 = Math.max(0, Math.round(y0));
    x1 = Math.min(img.w, Math.round(x1)); y1 = Math.min(img.h, Math.round(y1));
    const esc = Math.min(1, largura / (x1 - x0));
    const cv = document.createElement('canvas');
    cv.width = Math.round((x1 - x0) * esc); cv.height = Math.round((y1 - y0) * esc);
    cv.getContext('2d').drawImage(img.canvas, x0, y0, x1 - x0, y1 - y0, 0, 0, cv.width, cv.height);
    return cv.toDataURL('image/jpeg', 0.7);
  }

  /**
   * Lê uma foto e devolve { tipo: 'impressa'|'mao', linhas: [...] }.
   * Cada linha: { texto, confianca, candidatos: [{aluno, score, via}], aluno (sugestão),
   *               presente (sugestão), tinta (só impressa), imagem (recorte dataURL) }.
   */
  async function lerFolha(file, alunos, progresso, cursoDe) {
    const img = await prepararImagem(file);
    if (progresso) progresso('preparando', 0);
    const worker = await obterWorker(progresso);
    const { data } = await worker.recognize(img.canvas);
    const linhas = (data.lines || []).filter(l => l.text.trim().length >= 2);

    const analisadas = linhas.map(l => {
      const texto = l.text.replace(/\s+/g, ' ').trim();
      return { l, texto, confianca: l.confidence, candidatos: CC.casarTexto(texto, alunos) };
    });

    // Lista impressa: várias linhas com matrícula exata e texto nítido.
    const exatas = analisadas.filter(a => a.candidatos[0] && a.candidatos[0].score === 1 && a.candidatos[0].via === 'matrícula' && a.confianca >= 70);
    const tipo = exatas.length >= Math.max(5, analisadas.length * 0.3) ? 'impressa' : 'mao';

    const resultado = analisadas.map(a => {
      const bb = a.l.bbox, h = bb.y1 - bb.y0;
      const item = { texto: a.texto, confianca: Math.round(a.confianca), candidatos: a.candidatos, aluno: null, presente: false, tinta: null };
      const melhor = a.candidatos[0];
      if (melhor && melhor.score >= 0.5) item.aluno = melhor.aluno;
      if (tipo === 'impressa') {
        // Depois da última palavra impressa nítida da linha, o que houver de tinta é assinatura.
        // Palavras impressas: nítidas, ou parecidas com nome/matrícula/curso do aluno da linha
        // (o curso sai em letra miúda e às vezes é lido com pouca confiança).
        const conhecidas = item.aluno ? CC.norm(item.aluno.nome + ' ' + item.aluno.matricula + ' ' + (cursoDe ? cursoDe(item.aluno) : '')).split(' ') : [];
        const parecida = txt => { const n = CC.norm(txt).replace(/[^A-Z0-9]/g, ''); return n.length >= 3 && conhecidas.some(k => CC.levenshtein(n, k) <= Math.max(1, k.length * 0.34)); };
        const nitidas = (a.l.words || []).filter(wd => (wd.confidence >= 60 && /[A-Za-zÀ-ú0-9]{2,}/.test(wd.text)) || parecida(wd.text));
        const fimTexto = nitidas.length ? Math.max.apply(null, nitidas.map(wd => wd.bbox.x1)) : bb.x0;
        item.tinta = tintaNaFaixa(img, fimTexto + h * 0.8, bb.y0 + h * 0.15, img.w * 0.98, bb.y1 + h * 0.3);
        item.presente = !!item.aluno && item.tinta > LIMIAR_TINTA;
        item.imagem = recorte(img, bb.x0 - h, bb.y0 - h * 0.4, img.w, bb.y1 + h * 0.4, 640);
      } else {
        item.presente = !!item.aluno;
        item.imagem = recorte(img, bb.x0 - h * 0.5, bb.y0 - h * 0.4, Math.min(img.w, bb.x1 + h * 6), bb.y1 + h * 0.4, 640);
      }
      return item;
    });

    // Um aluno não pode valer por duas linhas: fica a de maior score.
    const dono = new Map();
    resultado.forEach((it, i) => {
      if (!it.aluno) return;
      const sc = it.candidatos[0].score;
      const atual = dono.get(it.aluno.id);
      if (!atual || sc > resultado[atual].candidatos[0].score) dono.set(it.aluno.id, i);
    });
    resultado.forEach((it, i) => {
      if (it.aluno && dono.get(it.aluno.id) !== i) { it.duplicada = true; it.aluno = null; it.presente = false; }
    });

    return { tipo, linhas: tipo === 'impressa' ? resultado.filter(it => it.aluno || it.candidatos.length) : resultado };
  }

  g.OCR = { lerFolha, prepararImagem, tintaNaFaixa };
})(window);
