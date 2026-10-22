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
  const isGenericName = name => !String(name || '').trim() || /^igreja$/i.test(String(name).trim());
  const symbolFor = name => {
    const parts = String(name || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    return (parts.slice(0, 2).map(part => part[0] || '').join('') || pretty(slugFromUrl).charAt(0) || 'I').toUpperCase();
  };

  let saved = null;
  try { saved = JSON.parse(localStorage.getItem('emaus-church-splash-v1') || 'null'); } catch (error) { saved = null; }
  const fresh = saved && Date.now() - Number(saved.at || 0) < 1000 * 60 * 60 * 24 * 30 ? saved : null;
  const cacheMatches = Boolean(
    fresh &&
    !isGenericName(fresh.name) &&
    (!slugFromUrl || !fresh.slug || String(fresh.slug).toLowerCase() === slugFromUrl)
  );
  const church = {
    name: (cacheMatches && fresh.name) || (slugFromUrl.length > 1 ? pretty(slugFromUrl) : ''),
    logoImage: (cacheMatches && fresh.logo) || '',
    slug: slugFromUrl || (cacheMatches && fresh.slug) || ''
  };

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

  function persist() {
    if (isGenericName(church.name)) return;
    try {
      localStorage.setItem('emaus-church-splash-v1', JSON.stringify({
        name: church.name || '',
        logo: resolveLogo(church.logoImage),
        slug: church.slug || slugFromUrl || '',
        at: Date.now()
      }));
    } catch (error) {}
  }

  // Quem abriu a pagina ainda sem login precisa da identidade publica desta igreja
  // (?igreja=<slug>). O cache "Igreja" de aberturas antigas e ignorado. A API so
  // e consultada depois de api-config.js ter definido EMAUS_API_URL.
  if (slugFromUrl) {
    const api = String(window.EMAUS_API_URL || '').replace(/\/$/, '');
    if (api && typeof fetch === 'function') {
      fetch(`${api}/api/public/church?slug=${encodeURIComponent(slugFromUrl)}`, { cache: 'no-store' })
        .then(response => (response.ok ? response.json() : null))
        .then(payload => {
          const found = payload && payload.church;
          if (!found) return;
          church.name = found.name || church.name;
          church.logoImage = found.logo_url || church.logoImage;
          church.slug = found.slug || slugFromUrl;
          apply();
          persist();
        })
        .catch(() => {});
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
      if (next.slug) church.slug = next.slug;
      apply();
      persist();
    },
    dismiss
  };
})();
