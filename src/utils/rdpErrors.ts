/** Explains Windows logon status codes returned by CredSSP / NLA (e.g. STATUS_LOGON_FAILURE). */
const NT_STATUS: Record<string, { name: string; hint: string }> = {
  c000006d: {
    name: 'STATUS_LOGON_FAILURE',
    hint:
      'Serwer odrzucił login lub hasło. Sprawdź hasło (wielkość liter, układ klawiatury) oraz domenę: konto domenowe wymaga domeny ' +
      '(pole „Domena” albo DOMENA\\użytkownik, ewentualnie użytkownik@domena.local), a konto lokalne serwera – formatu .\\użytkownik.',
  },
  c000006a: { name: 'STATUS_WRONG_PASSWORD', hint: 'Nieprawidłowe hasło.' },
  c0000064: { name: 'STATUS_NO_SUCH_USER', hint: 'Takie konto nie istnieje – sprawdź nazwę użytkownika i domenę.' },
  c000006e: {
    name: 'STATUS_ACCOUNT_RESTRICTION',
    hint: 'Ograniczenie konta (np. puste hasło niedozwolone dla logowania zdalnego lub członkostwo w grupie Protected Users).',
  },
  c000006f: { name: 'STATUS_INVALID_LOGON_HOURS', hint: 'Konto nie może się logować o tej porze.' },
  c0000070: { name: 'STATUS_INVALID_WORKSTATION', hint: 'Konto nie może logować się z tego komputera.' },
  c0000071: { name: 'STATUS_PASSWORD_EXPIRED', hint: 'Hasło wygasło – zmień je (np. przez mstsc lub na innym komputerze).' },
  c0000224: { name: 'STATUS_PASSWORD_MUST_CHANGE', hint: 'Hasło musi zostać zmienione przy następnym logowaniu – zmień je przez mstsc.' },
  c0000072: { name: 'STATUS_ACCOUNT_DISABLED', hint: 'Konto jest wyłączone.' },
  c0000193: { name: 'STATUS_ACCOUNT_EXPIRED', hint: 'Konto wygasło.' },
  c0000234: { name: 'STATUS_ACCOUNT_LOCKED_OUT', hint: 'Konto zostało zablokowane po zbyt wielu nieudanych próbach logowania.' },
  c000015b: {
    name: 'STATUS_LOGON_TYPE_NOT_GRANTED',
    hint: 'Konto nie ma prawa logowania przez Pulpit zdalny (grupa „Użytkownicy pulpitu zdalnego”).',
  },
  c0000413: { name: 'STATUS_AUTHENTICATION_FIREWALL_FAILED', hint: 'Logowanie zablokowane przez zasady uwierzytelniania domeny.' },
};

export const explainRdpError = (message: string): string | null => {
  const m = message.match(/0x([0-9a-f]{8})/i);
  if (m) {
    const entry = NT_STATUS[m[1].toLowerCase()];
    if (entry) return entry.hint;
  }
  for (const entry of Object.values(NT_STATUS)) {
    if (message.includes(entry.name)) return entry.hint;
  }
  return null;
};
