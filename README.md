# Insta Senses

Insta Senses is a privacy-first Chrome/Edge extension for comparing Instagram follower and following snapshots. It reads only the account rows Instagram has already rendered while the user browses a list. All snapshots stay in the browser's local extension storage.

## What it gives you

- New and lost followers between any two snapshots.
- Mutuals, people who do not follow back, and people you do not follow back.
- Separate history for each Instagram profile, so captures never get mixed together.
- Import from Instagram's official JSON download for large accounts.
- Restorable local JSON backups for moving or recovering your snapshots.
- A local activity meter that slows or pauses scans when request volume rises.

## Install

1. Open `chrome://extensions` (or `edge://extensions`).
2. Turn on **Developer mode**.
3. Choose **Load unpacked** and select this folder.
4. Open your own Instagram profile and click the Insta Senses toolbar icon.

## Capture a snapshot

1. Choose **Capture followers** or **Capture following** in the popup.
2. The extension opens the selected Instagram list in place and a capture panel appears.
3. Keep the Instagram tab open. The extension scrolls at a conservative pace and the count increases as accounts load.
4. The snapshot saves automatically when no more accounts appear. You can pause or save early from the capture panel.
5. Repeat later, then open **View insights** to compare changes.

Profile pictures are captured from the list rows Instagram displays and lazy-loaded in the People view. Because Instagram CDN links can expire, the dashboard falls back to account initials when an older image is no longer available.

Accounts you currently follow show an **Unfollow** button next to **View profile**. It opens that account on Instagram for the final confirmation; the extension does not send hidden or bulk unfollow requests. When Instagram visibly changes the account from **Following** to **Follow**, Insta Senses creates an updated local following snapshot and refreshes the dashboard. Cancelling the Instagram confirmation leaves the snapshot unchanged.

For relationship insights such as mutuals and “doesn't follow back,” capture both lists.

### Faster option for large accounts

Open **View insights → History → Import JSON**, then select the `followers_*.json` and `following.json` files from Instagram's official information download. The extension combines split follower files and creates complete local snapshots without requesting Instagram pages one by one. The same importer also restores backups created with **Back up snapshots**.

## Development

The extension has no runtime dependencies or build step. After making changes, run:

```powershell
npm test
npm run check
```

Then reload the unpacked extension from the browser's extensions page.

## Account-safety boundaries

- No Instagram password or session token is collected.
- No private or undocumented Instagram API is called.
- Hands-free scrolling is paced and can be paused; there is no automatic following, unfollowing, removing, liking, or messaging.
- **Ban likelihood** estimates risk from local list-request volume, scan bursts, and Instagram throttle screens. High risk slows the scan; critical risk starts a cool-down and blocks new scans.
- Huge accounts should use **Import Instagram JSON** instead of scrolling the live list.
- Profile review actions open Instagram so the user remains in control.
- Captured data is stored locally and can be exported as JSON.

Instagram can change its page structure. If account detection stops working, the selectors in `content.js` may need to be adjusted.
