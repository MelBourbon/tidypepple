# Features

## The one idea

**Projects are not a separate type.** A task with an open step *is* a project. When all
steps are done, the project itself is back in “Next” (unless its status is Someday).
Several requirements follow from that on their own:

- A to-do becomes a project as soon as it has more than one next step.
- The action list never shows the project, only its next open step.
- A chip on the step leads back to the project – it is the same detail view.

See `src/domain/projects.ts` and `src/domain/listQuery.ts`.

## Capture syntax

```
Call Bob @phone +Moving #private !tomorrow >mon !!
└ title ┘ └context┘ └project┘ └tag┘ └due┘ └start┘ └important┘
```

**Tags** are free keywords: `#private` when capturing, or under “Tags” in the detail view,
as many as you like. They need no management – a tag exists as long as a task carries it,
and case doesn't matter. Next and All filter with the “Tag” chip, search finds tags too, and
`#pri` searches tags only. Projects are given with `+` (formerly `#`). A `+` or `#` without
letters after it, such as `+49 30 …` or `Ticket #123`, stays part of the title.

`!` (due) and `>` (start) understand `today`, `tomorrow`, `nextweek`, weekdays (`mon`…`sun`),
`+3`, `2026-10-01` and `1.10.` / `24.12.2027`. Independently of the UI language, the German
words `heute`, `morgen`, `übermorgen` and `mo`…`so` work as well. Anything not understood
simply stays in the title.

A standalone `!!` marks the task as **important**. The “Important” button in the detail view
does the same; “Important only” in the list shows nothing but these tasks.

After Enter, the field stays open for the next task. The most recently captured one appears
below as an “edit” link that leads straight to its detail view, for instance to add a note;
`Ctrl/⌘+Enter` captures and opens in one step.

A capture without context and without a date counts as unclarified and lands in the
**Inbox**; with a context or a date it goes straight to **Next**.

**Next** shows what can be done now; of a project, only the next step. **All** shows every
open task, including what is waiting or planned for someday, but not projects themselves;
by default in collapsible sections by status. Both lists remember sorting and filters
separately.

**Manual order:** With the sort set to “Manual”, a grip at the end of each row moves tasks
by drag and drop (mouse, touch, or keyboard: focus the grip, Space, arrow keys, Space). The
**Projects** view is always ordered this way. The position is stored in its own field,
`listOrder`, so reordering a list never changes the order of a project's steps (`order`).
Tasks that were never moved come last.

**Done** (check-mark icon in the header of **All**) shows completed tasks grouped by day.
There, the check mark reopens a task and the trash can deletes it – one at a time or all at
once, each with undo instead of a confirmation dialog.

**Attachments:** Images and PDFs can be attached in the detail view, up to 5 MB each and
200 MB in total. Photos are first scaled down to 2560 px on the long edge. Files are stored on
the device (IndexedDB, table `blobs`) and, with sync, encrypted in Supabase Storage; another
device only downloads a file once the task is opened. Without a subscription, new
attachments stay on the device. They are not included in the JSON backup.

**Reminders:** Pick a date and time under “Reminder” in the detail view (local time, field
`reminderAt`, synced like everything else). There are no automatic notifications, not even
for due dates. Permission is requested only when the first reminder is set. Delivery depends
on the platform (`src/components/ReminderScheduler.tsx`):

- **Android app** of the hosted version (2.1.0 and later, bridge 2; the wrapper is not public,
  `src/platform/android.ts` describes the interface): on every change, the PWA hands the whole list
  to the wrapper via `reminder.sync`. The wrapper schedules them with AlarmManager, even with
  the app closed and after a reboot. Reminders that arrive via sync from another device ring
  too.
- **Browser:** only while a tab is open. A reminder that was just missed (up to 10 minutes)
  is delivered late. A click opens the task (`public/notification-click.js`, loaded via
  `workbox.importScripts` in the service worker).

There is deliberately no server push: the server would need to know the times in plain text.

**Sharing (Android):** If the app is installed via Chrome, Edge or Samsung Internet, it
appears in the share menu. Shared text lands as a note in the Inbox; its beginning (or a
title sent along) becomes the title. Firefox and iOS don't support this. Existing
installations only pick it up once Chrome re-reads the manifest (up to about a day, or
immediately after reinstalling).

**Language:** German or English, by default following the browser language (neither German
nor English → English). It can be set per device under *Settings → Language*; switching
reloads the app. The manifest (name in the share menu, shortcuts) stays German.

**Text size:** *Settings → Text size* offers Small (87.5 %), Normal and Large (112.5 %) per
device. It scales the root font size so spacing and touch targets grow along
(`src/ui/textSize.ts`) – so specify text sizes in rem, not px.

**Feedback:** *Settings → Feedback* opens the
[GitHub issues](https://github.com/MelBourbon/tidypepple/issues/new/choose) in a new tab. If a
view crashes, the app shows an error page with “Reload” and “Report the problem” instead of
a blank page. The latter opens a new issue prefilled with version, platform, page and error
message. Issues are public, so the text asks the user to remove anything private before
submitting – they see it all before it is sent. Both targets are in `src/feedback.ts`.

**Icon:** `public/favicon.svg` is the source; `node scripts/render-icons.mjs` generates the
PNG icons from it. The “any” icons (desktop) are transparent; the maskable and Apple touch
icons use the warm gray `#faf9f7` as background, which Android and iOS round themselves.
Installed apps only pick up a new icon once Chrome re-reads the manifest (up to about a day,
or after reinstalling). The Android wrapper of the hosted version has its own copies.

Keyboard: `c` captures from anywhere, `j`/`k` move the focus in the list, `x` completes.
