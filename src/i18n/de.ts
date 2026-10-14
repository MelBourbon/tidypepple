/**
 * Alle nutzersichtbaren Texte an einem Ort. Kein i18n-Framework – ein Objekt je Sprache
 * reicht. Deutsch ist die Referenz: `Messages` leitet sich daraus ab, und `en.ts` muss
 * dieselbe Form haben, sonst baut es nicht. Ausgewählt wird in `./index.ts`.
 */
export const de = {
  app: 'TidyPepple',
  /** Für `toLocaleDateString` und das `lang`-Attribut. */
  dateLocale: 'de-DE',
  weekdaysShort: ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'],
  /** Erster Start: ein paar Kontexte, damit die Filterleiste nicht leer ist. */
  defaultContexts: ['zuhause', 'büro', 'telefon', 'unterwegs', 'rechner'],

  nav: {
    inbox: 'Inbox',
    list: 'Next',
    all: 'All',
    projects: 'Projekte',
    board: 'Board',
    done: 'Erledigt',
    settings: 'Einstellungen',
  },

  capture: {
    open: 'Schnell erfassen',
    placeholder: 'Was liegt an?',
    hint: '@kontext · +projekt · #tag · !morgen · >mo · !! wichtig',
    submit: 'Erfassen',
    cancel: 'Abbrechen',
    saved: (title: string) => `„${title}“ gespeichert.`,
    edit: (title: string) => `„${title}“ bearbeiten`,
    editAction: 'bearbeiten',
    editShortcut: 'Strg/⌘+Enter: erfassen und gleich öffnen',
  },

  list: {
    title: 'Next',
    allTitle: 'All',
    sort: 'Sortieren',
    filter: 'Kontexte',
    highPriorityOnly: 'Nur wichtige',
    context: 'Kontext',
    contextCount: (n: number) => `${n} Kontexte`,
    contextReset: 'Alle Kontexte zeigen',
    tag: 'Tag',
    tagCount: (n: number) => `${n} Tags`,
    tagReset: 'Alle Tags zeigen',
    status: 'Status',
    statusCount: (n: number) => `${n} Status`,
    statusReset: 'Alle Status zeigen',
    searchPlaceholder: 'Suchen, auch #tag',
    count: (n: number) => `${n} ${n === 1 ? 'Aufgabe' : 'Aufgaben'}`,
    noContext: 'Ohne Kontext',
    toggleSection: (title: string, collapsed: boolean) => `${title} ${collapsed ? 'aufklappen' : 'einklappen'}`,
    sortDir: (asc: boolean) => (asc ? 'aufsteigend' : 'absteigend'),
  },

  sort: {
    manual: 'Manuell',
    due: 'Fälligkeit',
    created: 'Erstellt am',
    context: 'Kontext',
    status: 'Status',
  },

  order: {
    up: (label: string) => `${label} nach oben`,
    down: (label: string) => `${label} nach unten`,
  },

  task: {
    notes: 'Notizen',
    notesPlaceholder: 'Gedanken, Links, Details …',
    steps: 'Nächste Schritte',
    addStep: 'Schritt hinzufügen',
    dueDate: 'Fällig am',
    deferDate: 'Sichtbar ab',
    clearDate: (field: string) => `${field} entfernen`,
    reminder: 'Erinnerung',
    reminderBlocked: 'Benachrichtigungen sind blockiert. Erlaube sie in den Einstellungen des Geräts bzw. Browsers.',
    reminderUnsupported: 'Dieser Browser kann keine Benachrichtigungen anzeigen.',
    reminderAppOutdated: 'Für Erinnerungen bitte die Android-App aktualisieren.',
    reminderBrowserHint: 'Im Browser kommt die Erinnerung nur, solange TidyPepple geöffnet ist.',
    reminderBadge: (when: string) => `Erinnerung ${when}`,
    context: 'Kontext',
    tag: 'Tag',
    project: 'Projekt',
    noProject: 'Ohne Projekt',
    openProject: 'Projekt öffnen',
    pickerSearch: 'Suchen oder neu …',
    pickerSearchLabel: (field: string) => `${field} suchen oder neu anlegen`,
    pickerCreate: (name: string) => `„${name}“ anlegen`,
    status: 'Status',
    waitingFor: 'Wartet auf',
    waitingForPlaceholder: 'Wen oder was?',
    mode: 'Schrittfolge',
    modeSequential: 'Nacheinander',
    modeParallel: 'Gleichzeitig',
    modeHint: {
      sequential: 'Nur der erste offene Schritt erscheint in der Liste.',
      parallel: 'Alle offenen Schritte erscheinen in der Liste.',
    },
    partOf: 'Teil von',
    delete: 'Löschen',
    complete: 'Erledigt',
    completedAt: (when: string) => `Erledigt ${when}`,
    reopen: 'Wieder öffnen',
    close: 'Schließen',
    titlePlaceholder: 'Titel',
    highPriority: 'Wichtig',
    notFound: 'Diese Aufgabe gibt es nicht (mehr).',
  },

  status: {
    inbox: 'Inbox',
    next: 'Nächste Aktion',
    waiting: 'Wartet',
    scheduled: 'Terminiert',
    someday: 'Irgendwann',
    done: 'Erledigt',
  },

  projects: {
    title: 'Projekte',
    nextStep: 'Nächster Schritt',
    count: (n: number) => `${n} ${n === 1 ? 'Projekt' : 'Projekte'}`,
    /** Kennzeichnung eines Projekts, das als Zeile in "All" steht. */
    badge: 'Projekt',
    active: 'Aktiv',
    /** Wartet, Terminiert oder Irgendwann – die Schritte stehen noch nicht in "Next". */
    paused: 'Ruhend',
    stalled: 'Kein nächster Schritt',
    allDone: 'Alle Schritte erledigt – Projekt abschließen?',
    progress: (done: number, total: number) => `${done}/${total} erledigt`,
    makeProject: 'Als Projekt führen',
    unmakeProject: 'Kein Projekt mehr',
  },

  done: {
    title: 'Erledigt',
    deleteAll: 'Alle löschen',
    sections: {
      today: 'Heute',
      week: 'Letzte 7 Tage',
      older: 'Älter',
    },
  },

  board: {
    title: 'Board',
    groupBy: 'Spalten',
    groups: {
      status: 'Status',
      context: 'Kontext',
      project: 'Projekt',
      due: 'Fälligkeit',
    },
    noContext: 'Ohne Kontext',
    noProject: 'Ohne Projekt',
    moved: 'Verschoben',
    pickedUp: (title: string) => `${title} aufgenommen.`,
    over: (target: string) => `Über ${target}.`,
    cancelled: 'Abgebrochen.',
  },

  due: {
    overdue: 'Überfällig',
    today: 'Heute',
    tomorrow: 'Morgen',
    week: 'Diese Woche',
    later: 'Später',
    none: 'Ohne Datum',
  },

  /** Badge wartender Aufgaben. */
  waiting: {
    label: 'Wartet',
    on: (who: string) => `Wartet auf ${who}`,
    /** Frist erreicht – so erscheint die Aufgabe in "Next". */
    followUp: 'Nachfassen',
    followUpWith: (who: string) => `Nachfassen bei ${who}`,
    since: (days: number) =>
      days === 0 ? 'seit heute' : days < 14 ? `seit ${days} ${days === 1 ? 'Tag' : 'Tagen'}` : `seit ${Math.floor(days / 7)} Wochen`,
  },

  empty: {
    inbox: 'Deine Inbox ist leer – genau so soll es sein.',
    inboxHint: 'Alles Neue landet hier, bis du entscheidest, was es ist.',
    list: 'Nichts zu tun.',
    listHint: 'Erfasse etwas Neues oder lockere den Kontextfilter.',
    projects: 'Noch keine Projekte.',
    projectsHint: 'Sobald eine Aufgabe einen Schritt hat, wird sie hier zum Projekt.',
    all: 'Keine offenen Aufgaben.',
    allHint: 'Erfasse etwas Neues oder lockere den Kontextfilter.',
    board: 'Keine Karten in dieser Ansicht.',
    search: 'Nichts gefunden.',
    highPriority: 'Keine wichtigen Aufgaben.',
    status: 'Keine Aufgaben mit diesem Status.',
    tag: 'Keine Aufgaben mit diesem Tag.',
    done: 'Noch nichts erledigt.',
    doneHint: 'Was du abhakst, findest du hier wieder – zum Wiederöffnen oder endgültigen Löschen.',
  },

  attachments: {
    title: 'Anhänge',
    add: 'Anhängen',
    saving: 'Wird gespeichert …',
    remove: 'Anhang entfernen',
    removed: 'Anhang entfernt',
    missing: 'Nicht auf diesem Gerät',
    loading: 'Wird geladen …',
    notUploaded: 'Noch nicht hochgeladen',
    loadFailed: 'Laden fehlgeschlagen',
    retry: 'Erneut laden',
    openFailed: 'Keine App gefunden, die diese Datei öffnen kann.',
    count: (n: number) => `${n} ${n === 1 ? 'Anhang' : 'Anhänge'}`,
    hint: 'Bilder und PDFs bis 5 MB, insgesamt 200 MB. Fotos werden verkleinert. Mit Synchronisation liegen Anhänge verschlüsselt auf dem Server, sonst nur auf diesem Gerät. In der JSON-Sicherung sind sie nicht enthalten.',
    problem: {
      type: (name: string) => `„${name}" ist weder Bild noch PDF.`,
      size: (name: string) => `„${name}" ist größer als 5 MB.`,
      quota: (name: string) => `Kein Platz für „${name}" – die 200 MB für Anhänge sind belegt.`,
    },
  },

  share: {
    received: 'In der Inbox gespeichert',
    filesFailed: 'Die geteilten Dateien konnten nicht übernommen werden.',
  },

  undo: {
    deleted: 'Gelöscht',
    deletedMany: (n: number) => `${n} ${n === 1 ? 'Aufgabe' : 'Aufgaben'} gelöscht`,
    completed: 'Erledigt',
    promoted: (title: string) => `„${title}" ist jetzt ein Projekt`,
    action: 'Rückgängig',
  },

  sync: {
    offline: 'Offline',
    synced: 'Synchron',
    pending: (n: number) => `${n} offen`,
    localOnly: 'Nur auf diesem Gerät',
    locked: 'Gesperrt',
    readOnly: 'Nur Lesen',
    signedOut: 'Nicht angemeldet',
    unknownError: 'Unbekannter Fehler beim Synchronisieren.',
    vaultExists:
      'Für dein Konto gibt es schon einen Vault, angelegt auf einem anderen Gerät. Entsperre ihn mit seiner Passphrase.',
    title: 'Synchronisation',
    unconfigured:
      'Kein Supabase-Projekt hinterlegt. Deine Daten liegen ausschließlich auf diesem Gerät.',
    unconfiguredHint: 'Zum Einrichten VITE_SUPABASE_URL und VITE_SUPABASE_ANON_KEY setzen.',
    email: 'E-Mail-Adresse',
    signIn: 'Anmeldelink senden',
    signInSent: (email: string) => `Wir haben eine Mail an ${email} geschickt.`,
    signInSentHint:
      'Öffne den Link in der Mail – oder gib hier den Code aus der Mail ein. Der Code ist nötig, wenn TidyPepple als Homescreen-App läuft und der Link im Browser aufgeht.',
    code: 'Code aus der Mail',
    verifyCode: 'Anmelden',
    otherEmail: 'Andere E-Mail-Adresse',
    signOut: 'Abmelden',
    syncNow: 'Jetzt synchronisieren',
    lockNow: 'Sperren',
    lastResult: (r: { pushed: number; pulled: number; filesUploaded: number }) =>
      `${r.pushed} gesendet · ${r.pulled} empfangen` +
      (r.filesUploaded > 0 ? ` · ${r.filesUploaded} ${r.filesUploaded === 1 ? 'Anhang' : 'Anhänge'} hochgeladen` : ''),
    filesQuota: 'Die 200 MB für Anhänge sind auf dem Server belegt. Neue Anhänge bleiben vorerst auf diesem Gerät.',

    setupTitle: 'Vault einrichten',
    setupHint:
      'Die Passphrase verschlüsselt deine Daten auf diesem Gerät. Der Server sieht sie nie – und kann sie auch nicht zurücksetzen.',
    passphrase: 'Passphrase',
    passphraseRepeat: 'Passphrase wiederholen',
    passphraseMismatch: 'Die Passphrasen stimmen nicht überein.',
    passphraseTooShort: 'Bitte mindestens 10 Zeichen.',
    create: 'Vault anlegen',

    recoveryTitle: 'Wiederherstellungsschlüssel',
    recoveryHint:
      'Schreib ihn auf und bewahre ihn sicher auf. Ohne Passphrase ist er der einzige Weg zurück zu deinen Daten – wir können ihn nicht noch einmal anzeigen.',
    recoveryConfirm: 'Ich habe ihn gesichert',
    recoveryCopy: 'Kopieren',

    premiumTitle: 'Synchronisation ist ein bezahltes Feature',
    premiumBody:
      'Offline bleibt alles kostenlos: Erfassen, Projekte, Board, Suche – dein Gerät braucht dafür keine Verbindung. Bezahlt wird nur das Abgleichen zwischen mehreren Geräten und die Sicherung in der Cloud.',
    premiumReadOnly:
      'Deine Daten auf dem Server bleiben erreichbar: Änderungen werden weiterhin heruntergeladen, nur das Hochladen ist gesperrt. Lokal geht nichts verloren – sobald du buchst, wird alles nachgeschoben.',
    premiumPending: (n: number) =>
      `${n} ${n === 1 ? 'Änderung wartet' : 'Änderungen warten'} auf die Übertragung.`,
    // In Deutschland muss die Schaltfläche eindeutig auf die Zahlungspflicht hinweisen
    // (§ 312j BGB). "Jetzt kaufen" genügt dafür nicht.
    premiumBuy: 'Zahlungspflichtig bestellen',
    premiumRefresh: 'Status aktualisieren',
    premiumOtherEmail: (email: string) =>
      `Schon bezahlt? Das Abo gilt für die E-Mail-Adresse aus der Bestellung. Du bist als ${email} angemeldet – stimmt das nicht überein, melde dich ab und mit der Adresse aus der Bestellung wieder an.`,

    // Erst bezahlen, dann anmelden: Kaufangebot vor der Anmeldung.
    buyTitle: 'Auf allen Geräten synchron',
    buyBody:
      'Deine Aufgaben werden Ende-zu-Ende-verschlüsselt zwischen deinen Geräten abgeglichen und in der Cloud gesichert. Offline bleibt die App kostenlos.',
    buyAfter: 'Nach dem Kauf bekommst du einen Anmeldelink an die E-Mail-Adresse aus der Bestellung.',
    haveAccess:
      'Schon gekauft oder ein weiteres Gerät? Melde dich mit der E-Mail-Adresse aus der Bestellung an.',
    premiumNotConfigured:
      'Auf diesem Server ist kein Kauf eingerichtet. Wer ihn betreibt, kann den Sync ohne Abo freigeben: update private.settings set require_subscription = false;',
    // Android-App: dort gibt es keinen Hinweis auf andere Bezahlwege (Google-Play-Richtlinie).
    purchaseUnavailableApp: 'In der App kann das Abo derzeit nicht abgeschlossen werden.',
    purchaseConflict:
      'Dieses Google-Play-Abo gehört schon zu einem anderen TidyPepple-Konto. Melde dich mit diesem Konto an, um es zu nutzen.',
    purchaseFailed:
      'Der Kauf konnte nicht abgeschlossen werden. Wurde schon abgebucht, tippe auf „Status aktualisieren“ – die App meldet den Kauf dann erneut.',

    // Aktives Abo in den Einstellungen. `provider` ist leer bei manuellen Freischaltungen.
    subscriptionActive: (provider: string) => (provider === '' ? 'Abo aktiv' : `Abo aktiv, verwaltet über ${provider}`),
    subscriptionEnds: (date: string) => `Gekündigt, läuft noch bis ${date}.`,
    subscriptionManage: 'Abo verwalten',

    unlockTitle: 'Vault entsperren',
    unlock: 'Entsperren',
    useRecovery: 'Passphrase vergessen? Wiederherstellungsschlüssel verwenden',
    usePassphrase: 'Doch die Passphrase verwenden',
    recoveryKeyLabel: 'Wiederherstellungsschlüssel',
  },

  update: {
    available: 'Neue Version verfügbar',
    reload: 'Neu laden',
  },

  appUpdate: {
    available: (version: string) => `App-Version ${version} verfügbar`,
    required: (version: string) => `Bitte die App auf ${version} aktualisieren`,
    download: 'Herunterladen',
    dismiss: 'Später',
  },

  storageNotice: {
    title: 'Deine Daten liegen nur in diesem Browser',
    body: 'Sie gehören dir und verlassen das Gerät nicht. Löschst du die Browserdaten, sind aber auch deine Aufgaben weg. Sichere sie mit der Synchronisation oder exportiere sie regelmäßig.',
    titleApp: 'Deine Daten liegen nur in dieser App',
    bodyApp: 'Sie gehören dir und verlassen das Gerät nicht. Löschst du den App-Speicher oder deinstallierst du die App, sind aber auch deine Aufgaben weg. Sichere sie mit der Synchronisation oder exportiere sie regelmäßig.',
    backup: 'Daten sichern',
    dismiss: 'Verstanden',
  },

  settings: {
    title: 'Einstellungen',
    contexts: 'Kontexte',
    contextsHint: 'Die Reihenfolge gilt in Liste und Board: oben steht vorn, im Board links.',
    contextName: (name: string) => `Kontext ${name}`,
    newContext: 'Neuer Kontext',
    addContext: 'Hinzufügen',
    data: 'Daten',
    export: 'Als JSON exportieren',
    import: 'Sicherung einspielen',
    importHint:
      'Eingespielte Daten überschreiben den aktuellen Stand und werden synchronisiert. Anhänge sind in der Sicherung nicht enthalten.',
    imported: (r: { tasks: number; contexts: number }) =>
      `${r.tasks} Aufgaben und ${r.contexts} Kontexte eingespielt`,
    importFailed: 'Die Datei konnte nicht gelesen werden.',
    exportFailed: 'Die Sicherung konnte nicht gespeichert werden.',
    sync: 'Synchronisation',
    about: 'Über',
    textSize: 'Schriftgröße',
    textSizes: { small: 'Klein', normal: 'Normal', large: 'Groß' },
    language: 'Sprache',
    languageAuto: (detected: string) => `Automatisch (${detected})`,
    feedback: 'Feedback',
    feedbackHint: 'Fehler gefunden oder eine Idee? Schreib ein Issue auf GitHub – dort siehst du auch, was andere schon gemeldet haben.',
    feedbackButton: 'Feedback geben',
  },

  api: {
    title: 'API-Zugriff (MCP)',
    intro:
      'Mit einem API-Token greifen Claude, andere KI-Assistenten oder eigene Skripte über den TidyPepple-MCP-Server auf deine Aufgaben zu. Entschlüsselt wird auf deinem Rechner, unser Server sieht weiterhin nur verschlüsselte Daten.',
    privacy: 'Was ein Assistent abruft, sieht dessen Anbieter. Mit „Nur Tag“ im MCP-Server lässt sich die Sicht auf Aufgaben mit einem Tag beschränken.',
    none: 'Noch keine Tokens.',
    read: 'Lesen',
    write: 'Lesen und Schreiben',
    lastUsed: (when: string) => `zuletzt benutzt ${when}`,
    neverUsed: 'noch nie benutzt',
    revoke: 'Widerrufen',
    revokeConfirm: 'Wirklich widerrufen?',
    revokeHint:
      'Widerrufen sperrt den Zugang sofort. Daten, die mit dem Token schon abgerufen wurden, bleiben für dessen Besitzer lesbar.',
    newTitle: 'Neues Token',
    name: 'Name',
    namePlaceholder: 'z. B. Claude Desktop',
    scope: 'Berechtigung',
    passphraseHint: 'Deine Passphrase verpackt den Schlüssel für das Token. Sie verlässt das Gerät nicht.',
    create: 'Token erstellen',
    wrongPassphrase: 'Die Passphrase stimmt nicht.',
    createdTitle: 'Dein API-Token',
    createdHint: 'Es wird nur jetzt angezeigt. Wer es hat, kann deine Aufgaben lesen – bewahre es wie ein Passwort auf.',
    copy: 'Kopieren',
    copied: 'Kopiert',
    done: 'Fertig',
    setupDesktop: 'Claude Desktop',
    setupDesktopHint: 'Erweiterung herunterladen, doppelt anklicken und das Token einfügen.',
    download: 'Erweiterung herunterladen',
    setupCode: 'Claude Code',
    setupOther: 'Andere MCP-Clients und Skripte',
  },

  crash: {
    title: 'Hier ist etwas schiefgelaufen',
    body: 'Deine Aufgaben sind sicher auf diesem Gerät gespeichert. Meist hilft es, die App neu zu laden.',
    reload: 'Neu laden',
    report: 'Fehler melden',
    reportSubject: 'Fehler in TidyPepple',
    reportBody: (details: string) =>
      `Was hast du gerade gemacht?\n\n\n---\nTechnische Angaben (bitte stehen lassen). Diese Meldung ist öffentlich – steht unten etwas Privates, etwa ein Aufgabentitel, bitte vorher entfernen:\n${details}`,
    notFound: 'Diese Seite gibt es nicht',
    notFoundBody: 'Vielleicht ein altes Lesezeichen.',
    home: 'Zur Liste',
  },
} as const;

/** `de` ohne Literaltypen: dieselbe Form, beliebiger Text. */
type Widen<T> = T extends string
  ? string
  : T extends (...args: infer A) => infer R
    ? (...args: A) => Widen<R>
    : { readonly [K in keyof T]: Widen<T[K]> };

export type Messages = Widen<typeof de>;
