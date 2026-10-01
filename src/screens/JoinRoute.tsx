import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { FullScreenMessage } from '../components/FullScreenMessage';
import { parseInviteToken, writePendingInvite } from '../lib/invite';

/**
 * `#/join/<token>` — an invitation link. Rendered **outside every gate**, because the person
 * opening it has no account yet.
 *
 * It only banks the token and moves on to `/`: the gates then do what they always do (sign up,
 * then the join form), and `Auth`/`Onboarding` read the stored token to say "you were invited".
 * Held in storage rather than in the URL because sign-up can take a while and a reload partway
 * through must not lose the invitation. A token that is not even shaped like one is ignored
 * rather than overwriting a good one already stored.
 */
export function JoinRoute() {
  const { token } = useParams();
  const navigate = useNavigate();

  useEffect(() => {
    const parsed = parseInviteToken(token);
    if (parsed) writePendingInvite(parsed);
    navigate('/', { replace: true });
  }, [token, navigate]);

  return <FullScreenMessage text="טוען..." />;
}
