(() => {
  const splash = document.querySelector('#emausSplash');
  if (!splash) return;

  // Tempo do cartao de entrada da igreja, definido por quem cuida da igreja: 4 segundos.
  const SPLASH_DURATION_MS = 4000;

  const params = new URLSearchParams(window.location.search);
  const slugFromUrl = String(params.get('igreja') || params.get('church') || '').trim().toLowerCase();
  const pretty = value => String(value || '').replace(/[-_]+/g, ' ').trim().replace(/\b\w/g, char => char.toUpperCase());
  const resolveLogo = value => {
    const source = String(value || '').trim();
    if (!source) return '';
    return /^(data:|https?:|\/|\.)/i.test(source) ? source : `./${source}`;
  };
  const symbolFor = name => {
    const parts = String(name || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    return (parts.slice(0, 2).map(part => part[0] || '').join('') || 'I').toUpperCase();
  };

  let saved = null;
  try { saved = JSON.parse(localStorage.getItem('emaus-church-splash-v1') || 'null'); } catch (error) { saved = null; }
  const fresh = saved && Date.now() - Number(saved.at || 0) < 1000 * 60 * 60 * 24 * 30 ? saved : null;
  const church = { name: (fresh && fresh.name) || (slugFromUrl.length > 2 ? pretty(slugFromUrl) : ''), logoImage: (fresh && fresh.logo) || '' };

  const logo = document.querySelector('#splashLogo');
  const logoText = document.querySelector('#splashLogoText');
  const kicker = document.querySelector('#splashKicker');

  // A tela de espera mostra SOMENTE a marca da propria igreja: logo quando ela
  // existe, iniciais do nome quando nao existe, e nenhum nome de plataforma aqui.
  function apply() {
    const symbol = symbolFor(church.name);
    if (kicker) kicker.textContent = church.name || 'Área da igreja';
    const source = resolveLogo(church.logoImage);
    if (source && logo) {
      logo.onerror = () => {
        logo.hidden = true;
        logo.removeAttribute('src');
        if (logoText) { logoText.textContent = symbol; logoText.hidden = false; logoText.style.display = 'grid'; }
      };
      logo.src = source;
      logo.alt = `Logo da ${church.name || 'igreja'}`;
      logo.hidden = false;
      if (logoText) { logoText.hidden = true; logoText.style.display = 'none'; }
    } else {
      if (logo) { logo.hidden = true; logo.removeAttribute('src'); }
      if (logoText) { logoText.textContent = symbol; logoText.hidden = false; logoText.style.display = 'grid'; }
    }
  }
  apply();

  // Quem abriu a pagina sem login (visitante) ainda nao tem identidade salva: busca
  // a identidade dessa igreja no proprio endereco (?igreja=<slug>) para o logo ja
  // aparecer no cartao de espera. Se a rede demorar, o cartao sai no tempo mesmo.
  if (!church.logoImage && slugFromUrl) {
    const api = String(window.EMAUS_API_URL || '').replace(/\/$/, '');
    if (api && typeof fetch === 'function') {
      const wait = new Promise(resolve => window.setTimeout(() => resolve(null), 2500));
      const request = fetch(`${api}/api/public/church?slug=${encodeURIComponent(slugFromUrl)}`, { cache: 'no-store' })
        .then(response => (response.ok ? response.json() : null)).catch(() => null);
      Promise.race([request, wait]).then(payload => {
        const found = payload && payload.church;
        if (!found) return;
        church.name = found.name || church.name;
        church.logoImage = found.logo_url || '';
        apply();
        try { localStorage.setItem('emaus-church-splash-v1', JSON.stringify({ name: church.name || '', logo: resolveLogo(found.logo_url), at: Date.now() })); } catch (error) {}
      });
    }
  }

  let dismissed = false;
  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    splash.classList.add('is-leaving');
    window.setTimeout(() => splash.remove(), 650);
  };

  // Depois dos 4 segundos o cartao sai e a pagina abre.
  window.setTimeout(dismiss, SPLASH_DURATION_MS);
  // A pagina publica, ja com os dados da igreja em maos, pode atualizar o cartao.
  window.__emausSplash = {
    update(next) {
      if (!next) return;
      church.name = next.name || church.name;
      church.logoImage = next.logo || church.logoImage;
      apply();
    },
    dismiss
  };
})();
