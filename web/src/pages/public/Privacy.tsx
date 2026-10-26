import { OPERATOR_EMAIL, Prose, PublicLayout } from './PublicLayout';

export const PRIVACY_UPDATED = 'October 26, 2026';

/**
 * Privacy policy for a hosted deployment. Written in plain language on purpose: the person reading it is a student
 * deciding whether to paste a Canvas cookie into someone else's server. `{{OPERATOR_EMAIL}}` is filled in by the operator.
 */
export function Privacy() {
  return (
    <PublicLayout>
      <Prose title="Privacy policy" updated={PRIVACY_UPDATED}>
        <p>
          collected is a dashboard that copies your school and personal data from services you connect (Canvas, Gradescope, Google Calendar, Todoist, a job feed) into one place so you can see it on one board. This page explains what a hosted instance of collected stores, why, where it lives, who can see it, and how to get it out again. It is short because the answer is simple: the instance keeps a copy of what your sources say, keeps your credentials for those sources encrypted so it can refresh that copy, and shares it with no one.
        </p>
        <p>
          The <strong>operator</strong> is whoever runs the instance you signed in to. For this instance, that is <code>{OPERATOR_EMAIL}</code>. If you run collected on your own server, you are the operator and this page describes what your server does.
        </p>

        <h2>What is stored</h2>
        <p>Two kinds of data, kept in separate places in the database.</p>
        <h3>Copies of what your sources say</h3>
        <ul>
          <li>
            <strong>Courses</strong>: names, codes, sections, schedule, links, the ids a course has in Canvas and Gradescope, and the colour and notes you give it.
          </li>
          <li>
            <strong>Assignments, submissions and grades</strong> from Canvas and Gradescope: titles, due dates, points, your scores, submission status, and the course's grading scheme.
          </li>
          <li>
            <strong>Course content</strong> from Canvas: the syllabus, module lists, file names and file metadata, announcements. File contents are never stored on the server; if you use file sync, your own laptop downloads them straight from Canvas.
          </li>
          <li>
            <strong>Calendar events</strong> from the Google calendars you select (or from a calendar's iCal address): titles, times, locations, descriptions, the calendar's name and colour.
          </li>
          <li>
            <strong>Tasks</strong> from Todoist: content, due dates, labels, project and section names, completion state.
          </li>
          <li>
            <strong>Job listings</strong> from the public feed you configure, and your own notes and stage for the ones you track.
          </li>
          <li>
            <strong>Your decisions on top of all that</strong>: items you hid, snoozed or marked done, dates you added by hand, which two rows are the same homework, your widget layout and settings.
          </li>
        </ul>
        <h3>Credentials for your sources</h3>
        <ul>
          <li>Your Canvas session cookie.</li>
          <li>Your Gradescope email address and password.</li>
          <li>A Google refresh token for the Calendar scopes you granted, or the secret iCal address of a calendar.</li>
          <li>Your Todoist API token.</li>
        </ul>
        <p>
          Each of these is encrypted with AES-256-GCM before it is written to disk, using a key that is kept on the server and never leaves it. The web app never shows a credential again after you save it. The operator can see that a credential is set, not what it is, unless they also hold the key file on the server (see "Security" below for what that means).
        </p>
        <h3>Account data</h3>
        <p>Your email address and name from the sign-in provider, and the time you signed in. That is all an account is.</p>

        <h2>Why it is stored</h2>
        <p>
          To show it to you. The board, the course panes, the to-do list, the grade estimates and the Todoist push all read from the server's copy, which is refreshed on a timer (every 5 to 60 minutes depending on the source) using the stored credentials. Nothing is stored for any other purpose: there is no analytics, no advertising, no profiling, no training of anything.
        </p>

        <h2>Where it is stored</h2>
        <p>
          On the operator's server, in one SQLite database file. Backups of that file are kept by the operator for restore purposes, typically for 14 days, and are as encrypted as the database itself (credentials encrypted, the rest in the clear). Where exactly the server and its backups are located is up to the operator; ask them at the address above.
        </p>

        <h2>How long it is kept</h2>
        <ul>
          <li>
            <strong>Source data</strong> is kept until you disconnect that source, at which point its credential is deleted immediately and its rows stop refreshing, or until you delete your account, at which point all of it is deleted.
          </li>
          <li>
            <strong>Rows that disappear at the source</strong> (an assignment removed from Canvas, an event deleted from a calendar) are marked deleted on the next refresh and purged after that.
          </li>
          <li>
            <strong>Your account</strong> and everything attached to it is deleted when you ask the operator to delete it, or when you delete it from Settings. Backups age out on the operator's schedule after that, normally within 14 days.
          </li>
        </ul>

        <h2>What is shared with third parties</h2>
        <p>Nothing, with one optional exception you control.</p>
        <p>
          The instance talks to the sources you connected, using your credentials, to read your data, and to Google Calendar or Todoist to create the events and tasks you ask it to create. It does not send your data to anyone else, does not sell it, and does not use it for advertising.
        </p>
        <p>
          <strong>The optional exception: the file-sync classifier.</strong> If you turn on file sync on your laptop and enable its model, the laptop agent sends the <em>names</em> of Canvas files and folders that no rule covers to TypeSafe (typesafe.ai), which answers with the folder each file belongs in. Only file names, folder names and your target descriptions are sent, never file contents, grades, events or credentials, and the request goes from your laptop under your own TypeSafe API key, not from the operator's server. Leave the model off and nothing is sent anywhere.
        </p>

        <h2>Google user data</h2>
        <p>
          If you connect Google Calendar through Google sign-in, collected requests the <code>calendar.readonly</code> and <code>calendar.events</code> scopes. Its use of information received from Google APIs adheres to the{' '}
          <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements. Specifically:
        </p>
        <ul>
          <li>Calendar data is used only to display your events on the dashboard and to create the events you add from it. It is not used for any other purpose.</li>
          <li>It is not transferred to anyone except as necessary to provide that feature (the server stores it so it can show it to you), or as required by law.</li>
          <li>It is never sold, never used for advertising, and never used to train or improve any model, generalized or otherwise.</li>
          <li>No human reads it, except with your explicit permission, for security purposes, to comply with the law, or in aggregated, anonymized form for internal operations.</li>
        </ul>
        <p>
          You can revoke access at any time from Settings → Sources → Disconnect (which deletes the refresh token) or from your{' '}
          <a href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer">
            Google account permissions
          </a>
          .
        </p>

        <h2>Cookies</h2>
        <p>
          One cookie: the session cookie that keeps you signed in. It is HttpOnly, Secure, and holds a random session id, nothing else. There are no tracking cookies, no third-party cookies, and no analytics scripts. Your browser also keeps your theme preference and a few interface settings in local storage, which never leave it.
        </p>

        <h2>Security</h2>
        <ul>
          <li>Everything between your browser and the server, and between the server and your sources, goes over HTTPS.</li>
          <li>Credentials are encrypted at rest with AES-256-GCM. The key lives in a file on the server with owner-only permissions, next to the database, and is never logged, exported or included in backups that leave the server.</li>
          <li>Tokens are scoped to what they are for: the Google token covers only the Calendar scopes you granted, the Todoist token only your Todoist, and tokens issued to the command-line client cannot change credentials, settings or export the database.</li>
          <li>The server only ever fetches from public HTTPS hosts you configured; it will not be pointed at private networks.</li>
          <li>The operator, holding root on the server and the key file, could technically decrypt your credentials. That is true of every hosted service that stores credentials; it is why the hosted instance is invite-only, why you should only sign in to an operator you trust, and why self-hosting exists.</li>
        </ul>

        <h2>Your rights</h2>
        <ul>
          <li>
            <strong>Export</strong>: Settings → Data exports your courses, settings, layout and decisions as JSON at any time. Source data is a copy of what is in your sources already.
          </li>
          <li>
            <strong>Delete</strong>: disconnecting a source removes its credential immediately. Deleting your account removes everything.
          </li>
          <li>
            <strong>Ask</strong>: for a copy of everything held about you, a correction, a deletion, or any question about this policy, write to <code>{OPERATOR_EMAIL}</code>. Expect an answer within 30 days.
          </li>
        </ul>
        <p>
          If you are in the EU, UK or another jurisdiction with data-protection law, the operator is the controller of this data and the rights above are the ones that law gives you; you may also complain to your local supervisory authority.
        </p>

        <h2>Changes</h2>
        <p>
          If this policy changes in a way that matters (new data stored, a new third party, a new purpose), the date at the top moves and the change is announced in the app before it takes effect. Editorial fixes just move the date.
        </p>

        <h2>Contact</h2>
        <p>
          Operator of this instance: <code>{OPERATOR_EMAIL}</code>. The software is open source; its source and issue tracker are on GitHub, linked in the footer.
        </p>
      </Prose>
    </PublicLayout>
  );
}
