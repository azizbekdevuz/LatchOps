# Review UI changes (2026-11-22)

Checked in the browser on `http://127.0.0.1:3000` after the change, at desktop width and at 390×844. Safety rules are unchanged: consent, four-eyes approval, and the isolated-run gate still live on the server.

Desktop: "Open this conflict" enabled after the actor list loaded and opened S01. The Decision step then scrolled the decision panel into view.

Phone width: no horizontal overflow (`scrollWidth` 390). The header collapsed to a menu that still contains Review. The Decision step scrolled the panel to about 96px from the top of an 844px viewport.

## Before

- `/review` opened as a wall of equal scenario cards. The first thing on each card was a colored `expected VERIFIED` or `expected BLOCKED` pill, which looked like a result before a review existed.
- There was no single action for a first visit. A viewer role disabled every card with one yellow sentence.
- On a review, the step labels (Evidence, Explanation, Decision, Isolated run) did not move the page. On a phone the evidence list sat above the consent and approval controls, with no way to jump.
- The marketing home offered "Review a merge" and "Open incident room" with no distinction.

## After

- The first block on `/review` is "Open this conflict" for the checkout `deploy.env` case. The button says the requester is Minji and Jun must approve.
- While a repository is being built, a status line says so.
- Scenario cards keep the fixture target as plain text (`fixture target VERIFIED`), not a result pill.
- The four step labels are buttons that scroll to Evidence, Explanation, Decision, and Isolated run.
- The marketing home states that review needs no account and the incident room is the signed-in history.

## Not changed

- Evidence, citation checks, consent, approval, and execution panels keep their existing controls.
- No new product area was added.
