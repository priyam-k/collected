import { Link } from 'react-router';
import { LICENSE_URL, OPERATOR_EMAIL, Prose, PublicLayout } from './PublicLayout';

export const TERMS_UPDATED = 'October 26, 2026';

/** Terms for a hosted deployment. Short on purpose; the software's own licence is the AGPL, linked below. */
export function Terms() {
  return (
    <PublicLayout>
      <Prose title="Terms of service" updated={TERMS_UPDATED}>
        <p>
          These terms cover your use of the hosted instance of collected run by the operator named at the bottom of this page. Signing in means you agree to them. They are deliberately short. If you self-host collected, none of this applies; only the software licence does.
        </p>

        <h2>The service</h2>
        <p>
          collected copies data from services you connect (Canvas, Gradescope, Google Calendar, Todoist, a job feed) and shows it on one board. It is provided <strong>as is</strong>, free of charge, during an invite-only beta. It can change, pause or shut down; if it shuts down you will get at least 30 days' notice and a way to export your data.
        </p>

        <h2>No warranty</h2>
        <p>
          The service is provided without warranty of any kind, express or implied, including fitness for a particular purpose. In particular: the board is a copy, and the copy can be stale, incomplete or wrong. Your school's systems remain the source of truth for due dates, grades and submissions. Check them before anything that matters. To the fullest extent permitted by law, the operator is not liable for any loss arising from your use of the service, including a missed deadline.
        </p>

        <h2>Your account</h2>
        <ul>
          <li>You sign in with a Google account you control. Keep that account secure; what it can reach, the service can reach.</li>
          <li>The credentials you store (a Canvas cookie, a Gradescope password, tokens) are yours. By storing them you confirm you are allowed to use those services and that automating your own access does not breach their terms as they apply to you.</li>
          <li>One person per account. Do not share it.</li>
        </ul>

        <h2>Acceptable use</h2>
        <p>Do not use the service to:</p>
        <ul>
          <li>access anyone's data but your own, or store credentials that are not yours;</li>
          <li>put unreasonable load on the service or on the sources it connects to (it polls on fixed timers; do not work around them);</li>
          <li>probe, scan or attack the service, or try to reach other users' data;</li>
          <li>do anything unlawful.</li>
        </ul>

        <h2>Your data</h2>
        <p>
          You own your data. The operator claims no rights to it and uses it only to run the service for you, as the <Link to="/privacy">privacy policy</Link> describes. You can export it from Settings at any time and delete it by deleting your account.
        </p>

        <h2>Suspension</h2>
        <p>
          The operator may suspend or close an account that breaks these terms, that is being used to abuse a connected service, or whose stored credentials are causing a connected service to block the instance. Where practical you will be told why and given a chance to export your data first.
        </p>

        <h2>The software</h2>
        <p>
          collected is free software, licensed under the{' '}
          <a href={LICENSE_URL} target="_blank" rel="noreferrer">
            GNU Affero General Public License v3.0
          </a>
          . You may run it, study it, change it and share it under that licence. The source of the version running here is available from the GitHub link in the footer, as the AGPL requires.
        </p>

        <h2>Changes to these terms</h2>
        <p>Material changes are announced in the app before they take effect and move the date at the top. Continuing to use the service after that date means you accept them.</p>

        <h2>Governing law</h2>
        <p>
          These terms are governed by the laws of <code>{'{{GOVERNING_JURISDICTION}}'}</code>, without regard to conflict-of-law rules. Nothing in them limits rights that the consumer law where you live gives you and that cannot be waived.
        </p>

        <h2>Contact</h2>
        <p>
          Operator: <code>{OPERATOR_EMAIL}</code>.
        </p>
      </Prose>
    </PublicLayout>
  );
}
