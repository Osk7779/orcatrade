// Sprint auth-i18n-v1 — tri-locale (EN/PL/DE) for the PRE-auth funnel:
// /signup/, /account/ (sign-in state), /account/reset/.
//
// Why in-page (not /pl/signup/ dirs): auth surfaces are a single URL by
// architecture (see js/site-nav.js localizeHref — /account/ is never
// prefixed). So we localise client-side instead of cloning directory
// variants. Post-auth account management stays English by design —
// these pages cover the funnel a PL/DE visitor from localised marketing
// actually lands on BEFORE they're a committed user.
//
// Locale signal precedence:
//   1. ?lang=pl|de query param (links from localised pages can carry it)
//   2. navigator.language prefix (pl-PL → pl, de-AT → de)
//   3. 'en' fallback
//
// Usage:
//   - HTML: add data-i18n="key" to any element; applyAuthI18n() sets its
//     textContent. data-i18n-ph="key" sets a placeholder attribute.
//   - JS: window.authT('key') resolves a single string for dynamic copy
//     (button states, error messages).

(function () {
  'use strict';

  var DICT = {
    en: {
      // ── /signup/ ──
      signupTitle: 'Create your OrcaTrade account',
      signupLeadMagic: "Just your email — we'll send you a sign-in link. Magic-link only, no password.",
      signupLeadPassword: "Choose a password and we'll send a confirmation link to your email. The account activates only after you click it.",
      labelEmail: 'Email address',
      labelPassword: 'Password',
      phEmail: 'you@company.com',
      phNewPassword: 'At least 12 characters',
      pwHelpPassphrase: 'Length beats complexity. A passphrase like "ships sail east in winter" is fine.',
      btnSendLink: 'Send me a sign-in link',
      btnUsePassword: 'Use email + password',
      btnUseMagic: 'Use magic link instead',
      btnCreateAccount: 'Create account',
      btnSending: 'Sending…',
      haveAccount: 'Already have an account?',
      signInArrow: 'Sign in →',
      checkInbox: 'Check your inbox',
      sentMagic1: "is a valid address, we've sent you a sign-in link. Click the link in your email — it expires in 15 minutes.",
      sentMagicPrefix: 'If',
      sentPasswordPrefix: 'We sent a confirmation link to',
      sentPasswordSuffix: 'Click it within 1 hour to activate your account.',
      noEmailSpam: 'No email after a minute? Check spam, or',
      tryAgain: 'try again',
      errEmail: 'Enter a valid email address.',
      errPwShort: 'Password must be at least 12 characters.',
      errSignupFailed: 'Could not start signup.',
      errAccountExists: 'An account with this email already exists.',
      btnSignInInstead: 'Sign in instead →',
      errNetwork: 'Network error:',

      // ── /account/ sign-in state ──
      signinTitle: 'Sign in to OrcaTrade',
      signinLeadMagic: "Enter your email and we'll send you a sign-in link. No password — the link is good for 15 minutes.",
      signinLeadPassword: 'Enter your email and password to sign in.',
      phYourPassword: 'Your password',
      forgotPassword: 'Forgot password?',
      btnSignIn: 'Sign in',
      btnUsePasswordInstead: 'Use password instead',
      btnSigningIn: 'Signing in…',
      noAccountYet: 'No account yet?',
      createOne: 'Create one →',
      sentCheckInboxBody1: "is a valid address, we've sent you a sign-in link. Click the link in your email — it expires in 15 minutes.",
      sentCheckInboxPrefix: 'If',
      errEnterPassword: 'Enter your password.',
      errEnterEmailFirst: 'Enter your email address first, then click Forgot password.',
      errCouldNotSignIn: 'Could not sign in.',
      errCouldNotSendLink: 'Could not send sign-in link.',
      errResetNetwork: 'Network error sending reset link. Try again.',
      ssoSignin: 'Sign in with your company SSO',
      ssoEnterEmail: 'Enter your work email first, then click Sign in with SSO.',
      ssoNoneForDomain: 'No SSO is set up for that email domain. Use your email + password or a magic link.',

      // ── /account/reset/ ──
      resetTitle: 'Choose a new password',
      resetLead: 'Set a new password for your OrcaTrade account. After this change every other active session on this email is signed out.',
      labelNewPassword: 'New password',
      pwHelpShort: 'Length beats complexity. A passphrase is fine.',
      btnSaveNewPassword: 'Save new password',
      btnSaving: 'Saving…',
      resetNoTokenTitle: 'Reset link required',
      resetNoTokenBody: 'Open this page from the link in your password-reset email — the link carries the token we need to verify your request.',
      backToSignIn: '← Back to sign in',
      resetDoneTitle: 'Password updated',
      resetDoneBody: "You're signed in with the new password. Every other active session for this email has been signed out.",
      goToAccount: 'Go to your account →',
      errCouldNotSavePassword: 'Could not save new password.',
    },

    pl: {
      signupTitle: 'Załóż konto OrcaTrade',
      signupLeadMagic: 'Wystarczy e-mail — wyślemy Ci link do logowania. Tylko magic-link, bez hasła.',
      signupLeadPassword: 'Wybierz hasło, a wyślemy link potwierdzający na Twój e-mail. Konto aktywuje się dopiero po kliknięciu.',
      labelEmail: 'Adres e-mail',
      labelPassword: 'Hasło',
      phEmail: 'ty@firma.com',
      phNewPassword: 'Co najmniej 12 znaków',
      pwHelpPassphrase: 'Długość ważniejsza niż złożoność. Fraza w stylu „statki płyną na wschód zimą” jest w porządku.',
      btnSendLink: 'Wyślij mi link do logowania',
      btnUsePassword: 'Użyj e-maila i hasła',
      btnUseMagic: 'Użyj magic-linku',
      btnCreateAccount: 'Utwórz konto',
      btnSending: 'Wysyłanie…',
      haveAccount: 'Masz już konto?',
      signInArrow: 'Zaloguj się →',
      checkInbox: 'Sprawdź skrzynkę',
      sentMagic1: 'jest prawidłowym adresem, wysłaliśmy link do logowania. Kliknij link w e-mailu — wygasa po 15 minutach.',
      sentMagicPrefix: 'Jeśli',
      sentPasswordPrefix: 'Wysłaliśmy link potwierdzający na',
      sentPasswordSuffix: 'Kliknij go w ciągu 1 godziny, aby aktywować konto.',
      noEmailSpam: 'Brak e-maila po minucie? Sprawdź spam lub',
      tryAgain: 'spróbuj ponownie',
      errEmail: 'Podaj prawidłowy adres e-mail.',
      errPwShort: 'Hasło musi mieć co najmniej 12 znaków.',
      errSignupFailed: 'Nie udało się rozpocząć rejestracji.',
      errAccountExists: 'Konto z tym adresem e-mail już istnieje.',
      btnSignInInstead: 'Zaloguj się zamiast tego →',
      errNetwork: 'Błąd sieci:',

      signinTitle: 'Zaloguj się do OrcaTrade',
      signinLeadMagic: 'Podaj e-mail, a wyślemy Ci link do logowania. Bez hasła — link działa przez 15 minut.',
      signinLeadPassword: 'Podaj e-mail i hasło, aby się zalogować.',
      phYourPassword: 'Twoje hasło',
      forgotPassword: 'Nie pamiętasz hasła?',
      btnSignIn: 'Zaloguj się',
      btnUsePasswordInstead: 'Użyj hasła',
      btnSigningIn: 'Logowanie…',
      noAccountYet: 'Nie masz jeszcze konta?',
      createOne: 'Utwórz je →',
      sentCheckInboxBody1: 'jest prawidłowym adresem, wysłaliśmy link do logowania. Kliknij link w e-mailu — wygasa po 15 minutach.',
      sentCheckInboxPrefix: 'Jeśli',
      errEnterPassword: 'Podaj hasło.',
      errEnterEmailFirst: 'Najpierw podaj adres e-mail, a potem kliknij „Nie pamiętasz hasła”.',
      errCouldNotSignIn: 'Nie udało się zalogować.',
      errCouldNotSendLink: 'Nie udało się wysłać linku do logowania.',
      errResetNetwork: 'Błąd sieci przy wysyłaniu linku resetującego. Spróbuj ponownie.',
      ssoSignin: 'Zaloguj się przez firmowe SSO',
      ssoEnterEmail: 'Najpierw podaj służbowy e-mail, a potem kliknij „Zaloguj przez SSO”.',
      ssoNoneForDomain: 'Dla tej domeny e-mail nie skonfigurowano SSO. Użyj e-maila i hasła lub magic-linku.',

      resetTitle: 'Wybierz nowe hasło',
      resetLead: 'Ustaw nowe hasło do konta OrcaTrade. Po tej zmianie wszystkie inne aktywne sesje na tym e-mailu zostaną wylogowane.',
      labelNewPassword: 'Nowe hasło',
      pwHelpShort: 'Długość ważniejsza niż złożoność. Fraza jest w porządku.',
      btnSaveNewPassword: 'Zapisz nowe hasło',
      btnSaving: 'Zapisywanie…',
      resetNoTokenTitle: 'Wymagany link resetujący',
      resetNoTokenBody: 'Otwórz tę stronę z linku w e-mailu resetującym hasło — link zawiera token potrzebny do weryfikacji.',
      backToSignIn: '← Powrót do logowania',
      resetDoneTitle: 'Hasło zaktualizowane',
      resetDoneBody: 'Jesteś zalogowany przy użyciu nowego hasła. Wszystkie inne aktywne sesje na tym e-mailu zostały wylogowane.',
      goToAccount: 'Przejdź do konta →',
      errCouldNotSavePassword: 'Nie udało się zapisać nowego hasła.',
    },

    de: {
      signupTitle: 'OrcaTrade-Konto erstellen',
      signupLeadMagic: 'Nur Ihre E-Mail — wir senden Ihnen einen Anmeldelink. Nur Magic-Link, kein Passwort.',
      signupLeadPassword: 'Wählen Sie ein Passwort, und wir senden einen Bestätigungslink an Ihre E-Mail. Das Konto wird erst nach dem Klick aktiviert.',
      labelEmail: 'E-Mail-Adresse',
      labelPassword: 'Passwort',
      phEmail: 'sie@firma.com',
      phNewPassword: 'Mindestens 12 Zeichen',
      pwHelpPassphrase: 'Länge schlägt Komplexität. Eine Passphrase wie „Schiffe segeln im Winter nach Osten“ ist in Ordnung.',
      btnSendLink: 'Anmeldelink senden',
      btnUsePassword: 'E-Mail + Passwort verwenden',
      btnUseMagic: 'Stattdessen Magic-Link verwenden',
      btnCreateAccount: 'Konto erstellen',
      btnSending: 'Senden…',
      haveAccount: 'Haben Sie bereits ein Konto?',
      signInArrow: 'Anmelden →',
      checkInbox: 'Prüfen Sie Ihr Postfach',
      sentMagic1: 'eine gültige Adresse ist, haben wir Ihnen einen Anmeldelink gesendet. Klicken Sie auf den Link in Ihrer E-Mail — er läuft in 15 Minuten ab.',
      sentMagicPrefix: 'Wenn',
      sentPasswordPrefix: 'Wir haben einen Bestätigungslink gesendet an',
      sentPasswordSuffix: 'Klicken Sie ihn innerhalb von 1 Stunde an, um Ihr Konto zu aktivieren.',
      noEmailSpam: 'Keine E-Mail nach einer Minute? Prüfen Sie den Spam-Ordner, oder',
      tryAgain: 'erneut versuchen',
      errEmail: 'Geben Sie eine gültige E-Mail-Adresse ein.',
      errPwShort: 'Das Passwort muss mindestens 12 Zeichen lang sein.',
      errSignupFailed: 'Registrierung konnte nicht gestartet werden.',
      errAccountExists: 'Mit dieser E-Mail-Adresse besteht bereits ein Konto.',
      btnSignInInstead: 'Stattdessen anmelden →',
      errNetwork: 'Netzwerkfehler:',

      signinTitle: 'Bei OrcaTrade anmelden',
      signinLeadMagic: 'Geben Sie Ihre E-Mail ein, und wir senden Ihnen einen Anmeldelink. Kein Passwort — der Link gilt 15 Minuten.',
      signinLeadPassword: 'Geben Sie E-Mail und Passwort ein, um sich anzumelden.',
      phYourPassword: 'Ihr Passwort',
      forgotPassword: 'Passwort vergessen?',
      btnSignIn: 'Anmelden',
      btnUsePasswordInstead: 'Passwort verwenden',
      btnSigningIn: 'Anmeldung…',
      noAccountYet: 'Noch kein Konto?',
      createOne: 'Erstellen →',
      sentCheckInboxBody1: 'eine gültige Adresse ist, haben wir Ihnen einen Anmeldelink gesendet. Klicken Sie auf den Link in Ihrer E-Mail — er läuft in 15 Minuten ab.',
      sentCheckInboxPrefix: 'Wenn',
      errEnterPassword: 'Geben Sie Ihr Passwort ein.',
      errEnterEmailFirst: 'Geben Sie zuerst Ihre E-Mail-Adresse ein, dann klicken Sie auf „Passwort vergessen“.',
      errCouldNotSignIn: 'Anmeldung fehlgeschlagen.',
      errCouldNotSendLink: 'Anmeldelink konnte nicht gesendet werden.',
      errResetNetwork: 'Netzwerkfehler beim Senden des Reset-Links. Versuchen Sie es erneut.',
      ssoSignin: 'Mit Unternehmens-SSO anmelden',
      ssoEnterEmail: 'Geben Sie zuerst Ihre geschäftliche E-Mail ein, dann „Mit SSO anmelden“.',
      ssoNoneForDomain: 'Für diese E-Mail-Domain ist kein SSO eingerichtet. Nutzen Sie E-Mail + Passwort oder einen Magic-Link.',

      resetTitle: 'Neues Passwort wählen',
      resetLead: 'Legen Sie ein neues Passwort für Ihr OrcaTrade-Konto fest. Nach dieser Änderung werden alle anderen aktiven Sitzungen dieser E-Mail abgemeldet.',
      labelNewPassword: 'Neues Passwort',
      pwHelpShort: 'Länge schlägt Komplexität. Eine Passphrase ist in Ordnung.',
      btnSaveNewPassword: 'Neues Passwort speichern',
      btnSaving: 'Speichern…',
      resetNoTokenTitle: 'Reset-Link erforderlich',
      resetNoTokenBody: 'Öffnen Sie diese Seite über den Link in Ihrer Passwort-Reset-E-Mail — der Link enthält das Token, das wir zur Verifizierung benötigen.',
      backToSignIn: '← Zurück zur Anmeldung',
      resetDoneTitle: 'Passwort aktualisiert',
      resetDoneBody: 'Sie sind mit dem neuen Passwort angemeldet. Alle anderen aktiven Sitzungen dieser E-Mail wurden abgemeldet.',
      goToAccount: 'Zum Konto →',
      errCouldNotSavePassword: 'Neues Passwort konnte nicht gespeichert werden.',
    },
  };

  function detectLocale() {
    try {
      var params = new URLSearchParams(window.location.search);
      var q = (params.get('lang') || '').toLowerCase();
      if (q === 'pl' || q === 'de' || q === 'en') return q;
    } catch (_) { /* ignore */ }
    try {
      var nav = (navigator.language || navigator.userLanguage || 'en').slice(0, 2).toLowerCase();
      if (nav === 'pl' || nav === 'de') return nav;
    } catch (_) { /* ignore */ }
    return 'en';
  }

  var LOCALE = detectLocale();
  var STRINGS = DICT[LOCALE] || DICT.en;

  // Resolve a single key (falls back to EN, then the key itself).
  function authT(key) {
    if (STRINGS[key] != null) return STRINGS[key];
    if (DICT.en[key] != null) return DICT.en[key];
    return key;
  }

  // Walk the DOM and apply translations to [data-i18n] (textContent) and
  // [data-i18n-ph] (placeholder attribute) elements.
  function applyAuthI18n(root) {
    var scope = root || document;
    scope.querySelectorAll('[data-i18n]').forEach(function (el) {
      var key = el.getAttribute('data-i18n');
      var val = authT(key);
      if (val != null) el.textContent = val;
    });
    scope.querySelectorAll('[data-i18n-ph]').forEach(function (el) {
      var key = el.getAttribute('data-i18n-ph');
      var val = authT(key);
      if (val != null) el.setAttribute('placeholder', val);
    });
    // Reflect the resolved locale on <html lang> for a11y + downstream
    // scripts (cache-preferences.js reads documentElement.lang).
    try { if (LOCALE !== 'en') document.documentElement.setAttribute('lang', LOCALE); } catch (_) {}
  }

  // Expose for app.js (dynamic strings) + test/introspection.
  window.AUTH_I18N = DICT;
  window.authLocale = LOCALE;
  window.authT = authT;
  window.applyAuthI18n = applyAuthI18n;

  // Auto-apply on DOM ready so static pages need no extra wiring.
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { applyAuthI18n(); });
    } else {
      applyAuthI18n();
    }
  }
})();
