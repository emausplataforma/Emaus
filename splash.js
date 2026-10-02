(() => {
  const splash = document.querySelector('#emausSplash');
  if (!splash) return;

  // Cada igreja ve o proprio logo no splash. A fonte e a identidade salva pela
  // area da igreja no ultimo acesso (sem dados de negocio lidos do navegador).
  const params = new URLSearchParams(window.location.search);
  const slugFromUrl = String(params.get('igreja') || params.get('church') || '').trim().toLowerCase();
  const pretty = value => String(value || '').replace(/[-_]+/g, ' ').trim().replace(/\b\w/g, char => char.toUpperCase());
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem('emaus-church-splash-v1') || 'null'); } catch (error) { saved = null; }
  const fresh = saved && Date.now() - Number(saved.at || 0) < 1000 * 60 * 60 * 24 * 30 ? saved : null;
  const church = {
    name: (fresh && fresh.name) || (slugFromUrl.length > 2 ? pretty(slugFromUrl) : ''),
    logoImage: (fresh && fresh.logo) || '',
    initials: '',
    logoSymbol: ''
  };

  const logo = document.querySelector('#splashLogo');
  const logoText = document.querySelector('#splashLogoText');
  const kicker = document.querySelector('#splashKicker');
  const logoImage = String(church.logoImage || '').trim();
  const symbol = String(church.logoSymbol || church.initials || (church.name || '').replace(/\s+/g, ' ').trim().split(' ').slice(0, 2).map(part => part[0] || '').join('')).trim().toUpperCase() || 'E';

  if (kicker) kicker.textContent = church.name ? `Emaús · Igreja ${church.name}` : 'Emaús · área da igreja';
  if (logoImage && logo) {
    logo.src = logoImage;
    logo.alt = `Logo da ${church.name || 'igreja'}`;
    logo.hidden = false;
    if (logoText) logoText.hidden = true;
  } else if (logo) {
    logo.removeAttribute('src');
    logo.hidden = true;
    if (logoText) { logoText.textContent = symbol; logoText.hidden = false; logoText.style.display = 'grid'; }
  } else if (logoText) {
    logoText.textContent = symbol;
    logoText.hidden = false;
    logoText.style.display = 'grid';
    if (logo) logo.hidden = true;
  }

  let dismissed = false;
  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    splash.classList.add('is-leaving');
    window.setTimeout(() => splash.remove(), 650);
  };

  // Mantém a identidade Emaús + igreja visível por cinco segundos completos antes de sair.
  const splashDurationMs = 5000;
  window.setTimeout(dismiss, splashDurationMs);
})();
