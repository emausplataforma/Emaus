(() => {
  const splash = document.querySelector('#emausSplash');
  if (!splash) return;

  const fallbackChurch = { id: 'batesda', name: 'Bethesda', initials: 'BE', logoSymbol: 'B', logoImage: 'bethesda-logo.png' };
  // A identidade de produção vem do PostgreSQL depois do login; o splash não lê dados de negócio do navegador.
  const church = fallbackChurch;

  const logo = document.querySelector('#splashLogo');
  const logoText = document.querySelector('#splashLogoText');
  const kicker = document.querySelector('#splashKicker');
  const logoImage = String(church.logoImage || '').trim();
  const symbol = String(church.logoSymbol || church.initials || church.name || 'B').trim().slice(0, 2).toUpperCase() || 'B';

  if (kicker) kicker.textContent = `Emaús · Igreja ${church.name || 'Bethesda'}`;
  if (logoImage && logo) {
    logo.src = logoImage;
    logo.alt = `Logo da ${church.name || 'igreja'}`;
    logo.hidden = false;
    if (logoText) logoText.hidden = true;
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

  // Mantém a identidade Emaús/Bethesda visível por cinco segundos completos antes de sair.
  const splashDurationMs = 5000;
  window.setTimeout(dismiss, splashDurationMs);
})();
