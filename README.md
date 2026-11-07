# Insta Senses

Privacy-first follower insights for Instagram, built as a lightweight Chrome and
Microsoft Edge extension.

Insta Senses captures the follower and following lists that Instagram already
shows in your browser, stores snapshots locally, and compares them over time.
It does not ask for your Instagram password, send automated follow requests, or
use a private Instagram API.

> [!IMPORTANT]
> Insta Senses is an independent project and is not affiliated with Instagram
> or Meta. Instagram can change its interface at any time, which may temporarily
> affect list detection.

## Highlights

- Compare any two snapshots to find new and lost followers.
- See mutual connections and accounts that do not follow back.
- Keep captures from different Instagram profiles separated.
- Import official Instagram JSON exports for large accounts.
- Back up and restore Insta Senses snapshots as JSON.
- Review people with search and relationship filters.
- Open profiles for manual review or unfollow confirmation.
- Slow or pause scanning when local activity signals indicate elevated risk.
- Keep all captured data in the browser's local extension storage.
- Use a responsive, keyboard-accessible dashboard with reduced-motion support.

## How it works

```text
Instagram list in the active tab
            |
            v
Content script reads visible account rows
            |
            v
Local extension storage saves a snapshot
            |
            v
Dashboard compares snapshots in the browser
```

The extension only collects accounts that Instagram has rendered in the open
followers or following dialog. During a live capture, it scrolls the list at a
conservative pace and watches for new rows. For a large account, importing the
official Instagram JSON export is faster and avoids loading the complete list
through Instagram's interface.

## Installation

### Chrome

1. Download or clone this repository.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Select **Load unpacked**.
5. Choose the repository folder containing `manifest.json`.
6. Pin **Insta Senses** from the extensions menu for easy access.

### Microsoft Edge

1. Download or clone this repository.
2. Open `edge://extensions`.
3. Enable **Developer mode**.
4. Select **Load unpacked**.
5. Choose the repository folder containing `manifest.json`.

After installing, open your Instagram profile in the same browser and select
the Insta Senses toolbar icon.

## Usage

### Capture followers or following

1. Open the Instagram profile you want to inspect.
2. Select the Insta Senses toolbar icon.
3. Choose **Scan followers** or **Scan following**.
4. Keep the Instagram tab open while the capture panel is visible.
5. Allow the scan to finish, or use **Pause**, **Save**, or **Cancel**.
6. Select **View insights** to open the dashboard.

The snapshot saves automatically after the list stops producing new accounts.
Capturing both followers and following enables mutual and follow-back insights.

### Compare snapshots

The dashboard's **Overview** page lets you select a starting and ending
snapshot. It calculates:

- New followers
- Lost followers
- Newly followed accounts
- Accounts you stopped following

Select any result card to review the matching people.

### Review relationships

The **People** page provides these filters:

- Mutuals
- Accounts that do not follow you back
- Accounts you do not follow back
- All captured followers
- All captured following

Use the search field to filter by username or captured display name. Profile
images are lazy-loaded from the URLs Instagram displayed during capture. Since
Instagram CDN URLs may expire, the dashboard falls back to account initials.

### Manual unfollow workflow

When an account is in a list you currently follow, Insta Senses can display an
**Unfollow** action. This action:

1. Opens the person's Instagram profile.
2. Leaves the final unfollow decision to you in Instagram.
3. Watches for the visible button to change from **Following** to **Follow**.
4. Creates an updated local following snapshot after confirmation.

The extension does not send hidden or bulk unfollow requests. Closing the page
or cancelling Instagram's confirmation leaves the stored snapshot unchanged.

## Import Instagram data

For large accounts, use Instagram's official information download instead of a
live scan.

1. Request your Instagram information in JSON format from Meta's Accounts
   Center.
2. Extract the downloaded archive.
3. In Insta Senses, open **View insights → History → Import JSON**.
4. Select `followers_*.json`, `following.json`, or both.

Instagram may split followers across files such as `followers_1.json` and
`followers_2.json`. Insta Senses combines the selected files, removes
duplicate usernames, and creates one local snapshot for each relationship
type.

## Back up and restore

Open **History → Back up snapshots** to download a dated JSON backup for the
active Instagram profile. The backup contains:

- Format and schema version
- Export timestamp
- Active profile metadata
- Follower and following snapshots
- Captured usernames, display names, and avatar URLs

To restore it, choose **Import JSON** and select the Insta Senses backup.
Existing snapshots with the same profile, type, timestamp, and item count are
skipped to reduce accidental duplicates.

Keep backup files private: they contain the usernames present in your captured
lists.

## Privacy and account safety

### Data handling

- Snapshots stay in `chrome.storage.local` on the current browser profile.
- No analytics or telemetry service is included.
- No password, session token, cookie, or direct-message content is collected.
- No captured list is uploaded by the extension.
- Exporting a backup only creates a file on your device.

Uninstalling the extension may remove its local storage. Create a backup first
if you want to preserve your history.

### Scan boundaries

- The extension uses the Instagram page already open in your browser.
- It does not call a private or undocumented Instagram API.
- It does not automate follows, likes, comments, messages, or removals.
- Live scrolling uses delays and can be paused or cancelled.
- Critical local activity signals trigger a temporary cool-down.
- Large lists are better handled through official JSON import.

The displayed risk percentage is a local heuristic based on observed request
volume, scan activity, unfollow opens, and visible throttle or checkpoint
messages. It cannot predict Instagram's private enforcement systems or
guarantee that an account will not be restricted.

## Browser permissions

| Permission | Why it is needed |
| --- | --- |
| `storage` | Saves snapshots, the active profile, and local activity signals. |
| `tabs` | Finds the active Instagram tab and opens the insights dashboard. |
| `https://www.instagram.com/*` | Runs the capture interface on Instagram pages. |
| `https://instagram.com/*` | Supports Instagram URLs without the `www` prefix. |

The extension uses Manifest V3 and does not request broad access to unrelated
websites.

## Project structure

| File | Responsibility |
| --- | --- |
| `manifest.json` | Manifest V3 configuration and permissions |
| `popup.html`, `popup.css`, `popup.js` | Toolbar popup and scan controls |
| `content.js`, `content.css` | Instagram list detection and capture panel |
| `background.js` | Background message handling and dashboard opening |
| `store.js` | Storage, normalization, comparison, and risk assessment |
| `dashboard.html`, `dashboard.css`, `dashboard.js` | Insights, people, history, import, and backup UI |
| `tests/store.test.js` | Automated tests for core storage behavior |
| `icons/` | Extension icons |

## Development

### Requirements

- Chrome or Microsoft Edge
- Node.js 20 or newer for tests
- No runtime dependencies
- No build step

Clone the repository:

```powershell
git clone https://github.com/yassa-life/insta-senses.git
cd insta-senses
```

Run the automated tests:

```powershell
npm test
```

Check all JavaScript files for syntax errors:

```powershell
npm run check
```

If npm is unavailable but Node.js is installed, run the tests directly:

```powershell
node --test
```

After changing extension files:

1. Open the browser's extensions page.
2. Find Insta Senses.
3. Select **Reload**.
4. Refresh any Instagram tab that was already open.

### Testing checklist

Before publishing a change, verify:

- The popup detects an Instagram profile.
- Followers and following scans can start, pause, save, and cancel.
- Separate Instagram profiles do not share dashboard snapshots.
- Snapshot comparisons produce the expected added and removed accounts.
- Instagram JSON import accepts split follower files.
- Insta Senses backups export and restore successfully.
- Search, filters, keyboard focus, and mobile layouts remain usable.
- All automated tests and syntax checks pass.

## Troubleshooting

### The popup says “Open Instagram”

Open an Instagram profile page in the active tab and refresh it. If the
extension was just installed or reloaded, existing Instagram tabs must also be
refreshed so the content script can start.

### The scan is waiting for Instagram's list

Open the followers or following dialog manually. Instagram occasionally changes
its navigation or delays rendering the dialog.

### A scan stops or enters cool-down

The extension detected elevated local activity or an Instagram throttle signal.
Stop loading lists, wait for the displayed cool-down, or import the official
JSON download instead.

### Profile pictures show initials

Captured Instagram image URLs can expire. The stored username and relationship
data still work; only the old image is unavailable.

### Instagram JSON is not detected

Confirm that:

- The files use JSON rather than HTML format.
- Their names contain `followers` or `following`.
- You selected the extracted JSON files, not the original ZIP archive.

### Account detection stopped working

Instagram may have changed its HTML structure. Review the selectors and row
extraction logic in `content.js`, then reload the unpacked extension.

## Current limitations

- Only account rows rendered by Instagram can be captured during a live scan.
- Private, blocked, unavailable, or deactivated accounts may not appear.
- Display names and avatar URLs depend on what Instagram renders.
- Avatar URLs are not downloaded permanently and may expire.
- Instagram interface changes can require selector updates.
- The extension is distributed as an unpacked development extension; it is not
  currently listed in a browser extension store.

## Contributing

Bug reports and focused pull requests are welcome. When reporting a capture
problem, include:

- Browser and version
- Extension version
- Whether the issue affects followers, following, or both
- The visible behavior and expected behavior
- Console errors with personal usernames or account data removed

Do not include Instagram passwords, cookies, session tokens, or exported
follower data in an issue.

## Disclaimer

Use this project responsibly and in accordance with Instagram's terms and
applicable rules. Insta Senses provides local organizational insights, not a
guarantee against account restrictions. You remain in control of every profile
review and relationship action.
