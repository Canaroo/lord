# Beat Frets: working notes for Claude

## Testing before a push

The full browser run (`npm run e2e`) plays real songs in real time and takes 10–15 minutes, so
don't run it for every change.

**Every change:** run `npm test` (unit tests, a few seconds), plus the browser section that covers
what changed, then push:

| Changed | Run | About |
| --- | --- | --- |
| Phone layouts, touch controls, Tiles | `E2E_ONLY=touch npm run e2e` | a few min |
| World boards, challenges, races, notices, Players' music | `E2E_ONLY=world npm run e2e` | 2 min |
| Song list, Boards, records, Options save bar | `E2E_ONLY=records npm run e2e` | 1 min |
| Only songs, docs or style tweaks with no new behaviour | `npm test` alone | seconds |

**Full run (`npm run e2e`) only for big changes:** gameplay, scoring or timing, charts, input
(keyboard, controller, touch), saving, the service worker or versioning, or anything touching
several areas at once. When in doubt about whether a change is big, say which sections you ran.

A run that fails must be fixed before pushing, whichever kind it was.

## Publishing

Don't wait for approval before pushing finished work: once the checks above pass, commit and push,
then explain what changed (with previews or screenshots where useful). The user reviews afterwards
and asks for changes if needed. Still ask before starting when a request is unclear.
