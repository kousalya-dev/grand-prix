# 🏁 GRAND PRIX PRO (v2): car-themed team game

**Three rounds, one champion:**

| Round | What players do | Time | Points |
|---|---|---|---|
| 1 · Badge Hunt | Name the car brand from its logo (10 logos) | 30s each, 3 tries | +100 correct + up to +100 speed |
| 2 · Parts Hunt | Find hidden car parts in a 9×9 grid. There’s no word list: players spot the 12 parts themselves | 60s | +100 per part, +2/sec left if all found |
| 3 · Movie Shuffle | Swap the letter cubes to spell *Fast and Furious* | 60s | +300 solved + up to +200 speed |

**Ranking:** highest points first, then the least total time.

| Page | Who | Path |
|---|---|---|
| Players | everyone's phone (QR code) | `/` |
| Race control | your shared screen | `/host` |
| Setup | player list + logo check | `/admin` |

---

## ⚠️ Before the game: upload the 10 logos (2 minutes, no GitHub needed)
1. Open **`/admin`** (Setup) and enter your PIN.
2. In **Round 1 · Logos**, tap a slot (or drag an image onto it) to upload the logo.
   - Images are shrunk on your device and saved straight into the game's database, so there's no redeploy.
3. Each slot also has the **car name** and **"also accept"** short forms (e.g. *VW*, *Lambo*). Edit them and click outside the box to save.
4. Use logo versions **without the brand name written on them**.

| Slot | Car |
|---|---|
| 1 | Lamborghini |
| 2 | Porsche |
| 3 | Mazda |
| 4 | Aston Martin |
| 5 | Lexus |
| 6 | Koenigsegg |
| 7 | Jaguar |
| 8 | Mitsubishi |
| 9 | Bentley |
| 10 | Volkswagen |

Slots without an upload show a numbered placeholder.

## Player list
In `/admin`, paste one name per line and click **Save list**. The list appears in the join dropdown. Anyone missing taps **"My name isn't here"**, gets a "Sorry, missed your name!" message, and types it. The host screen marks them **✨ added themselves**.

## Running the game
1. **Lobby:** open `/host` and enter the PIN. The QR code is generated from the site's own URL. Players scan it, pick their name and emoji, and wait in the pit lane, where they can **grab the stick** (drag it onto a driver and swing) or tap a driver to bonk them 🏏. A crash-test dummy is always there for practice.
   - The host screen shows who has **joined** and who is **yet to join**.
2. **Engine start:** press **ENGINE START**. You'll see the ignition animation, hear the engine, and the briefing cards appear. Phones show the same card.
3. **Briefing:** click through the 3 cards (or tap the next card), then **🏁 START THE RACE**.
   - Everyone sees 3 red lights → **GO!** with a chequered flag.
4. **Race:** each player races at their own pace.
   - The host screen shows live timing: who is on which round, progress, logos/parts/movie, time and points.
   - The **top 5** get live alerts on their phones, e.g. "You're in P3, only 2 drivers ahead of you".
5. **End race:** when everyone shows 🏁 Finished, click **End race**. The podium and confetti appear.
6. **New race:** clears all players for another round.

## Deploy on Vercel
1. Upload all files (except `node_modules`/`data`) to a **private** GitHub repo, then go to **Vercel → Add New → Project → Import**.
2. Add the environment variable **`HOST_PIN`** (required).
3. Under **Upstash for Redis → Add**, connect a database. Reusing the Word Hunt one is fine; the keys don't clash.
4. Click **Deploy**. Your game is at `https://<project>.vercel.app`, and race control at `/host`.

**Optional env vars**
- `LOGO_TIME` (30), `PARTS_TIME` (60), `MOVIE_TIME` (60): seconds for each round.
- `PUBLIC_URL`: only needed for a custom domain.

## Changing content
Edit **`lib/content.js`** on GitHub (pencil icon):
- **Logo answers:** the defaults live here, but you can edit them at `/admin` without redeploying. Small typos are forgiven automatically.
- **Parts:** the list of 20; each race hides 12, because a 9×9 grid can't fit all 20.
- **Movie:** the title whose letters are shuffled.
- **Roster:** the default player list.

## Run locally
```bash
npm install
npm start
```
Open `http://localhost:3000/host`. The PIN is printed in the terminal.
