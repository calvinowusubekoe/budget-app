# Putting a test build online (Netlify + Render + MongoDB Atlas)

This puts Kontaa online for testers with free plans and no domain of your own. Testers open one address, for example `https://kontaa-test.netlify.app`.

| Part | Where | Why |
| --- | --- | --- |
| The app (what people see) | **Netlify** | Static hosting. It also passes `/api/*` to the server, so the browser sees one address and sign-in cookies work |
| The server (API) | **Render** (free web service) | Netlify can't run a long-lived Node server |
| The database | **MongoDB Atlas** (free M0 cluster) | Stores everything, including uploaded receipts (`UPLOAD_STORAGE=mongodb`) |

A test build runs with `APP_STAGE=test`, which means:
- every screen shows a "Test version" banner
- the sign-in page offers the shared demo account
- email isn't needed; messages are written to the server log
- the feedback button is on

The demo account is created automatically the first time the server starts.

It takes about 30 minutes. You need a GitHub account with this repository pushed to it.

## 1. Pick the address

Choose a Netlify site name now, for example `kontaa-test`. Your app's address will then be `https://kontaa-test.netlify.app`. You'll need that address in step 3.

## 2. Database: MongoDB Atlas

1. Sign up at mongodb.com/atlas and create a **free M0** cluster. Pick a region close to Ghana, such as AWS Frankfurt (`eu-central-1`).
2. **Database Access:** add a database user with a long generated password. Save it somewhere safe.
3. **Network Access:** add `0.0.0.0/0` (allow from anywhere). Render's free plan doesn't have fixed IP addresses. The database password still protects it.
4. **Connect, then Drivers:** copy the connection string. Put your password in, and add the database name `kontaa` before the `?`:
   `mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/kontaa?retryWrites=true&w=majority`

## 3. Server: Render

1. Sign up at render.com with GitHub.
2. Choose **New, then Blueprint**, pick this repository. Render reads `render.yaml`.
3. Fill in the values it asks for:

   | Setting | Value |
   | --- | --- |
   | `MONGODB_URI` | The Atlas connection string from step 2 |
   | `CLIENT_URL` | Your app address from step 1, e.g. `https://kontaa-test.netlify.app` (exactly, no slash at the end) |
   | `ANTHROPIC_API_KEY` | Your Anthropic key, for the AI assistant and receipt scanning |
   | `DEMO_PASSWORD` | A password for the shared demo account, e.g. `kontaa demo 2026` (10+ characters, letters and a number). Testers will see it, so don't reuse a real password |
   | `ADMIN_EMAILS` | Your own email address. Signing up with it lets you read feedback |

4. Create it. When the deploy finishes, copy the service address, e.g. `https://kontaa-api.onrender.com`. Check `https://kontaa-api.onrender.com/api/health`: it should say the database is `connected`.

The free plan sleeps after 15 minutes without visits, and the first visit after that takes up to a minute. While it wakes, the app shows "Can't reach Kontaa" and connects by itself.

## 4. App: Netlify

1. Sign up at netlify.com with GitHub.
2. Choose **Add new site, then Import an existing project**, and pick this repository. Netlify reads `netlify.toml`, so leave the build settings as they are.
3. Under **Site configuration, then Environment variables**, add `KONTAA_API_ORIGIN` = the Render address from step 3, e.g. `https://kontaa-api.onrender.com`.
4. Under **Site configuration, then Change site name**, set the name from step 1.
5. Deploy, or use **Trigger deploy** if the first one ran before you added the variable.

## 5. Check it, then invite the tester

1. Open `https://YOUR-SITE.netlify.app/guide`. You should see the tester guide with the demo sign-in.
2. Go to sign-in and choose **Use the demo account**. Efua's sample data should appear.
3. Sign out, then **Create an account** with the email you put in `ADMIN_EMAILS`. Your account menu (your initials) now has **Tester feedback**.
4. Send yourself a test note with the speech-bubble button and check it arrives.

## Message to send the tester

> Hi! Thanks for agreeing to try **Kontaa**, an app I'm building to keep track of money in one place: MoMo, bank and cash, budgets, savings, personal and group Susu, and small-business invoices.
>
> Start here: **https://YOUR-SITE.netlify.app/guide**. It explains what to try and has a demo account with sample data, so you don't need to enter anything real. Please use made-up details only.
>
> As you go, tap the **speech-bubble button** at the top of the screen to send me notes. It records which page you were on. Anything confusing, wrong or missing is useful, especially whether the figures and terms look right to someone who knows finance.
>
> It works on a phone or a computer. The first load can take up to a minute if nobody has used it for a while.

## Running it

- **Read feedback:** account menu, then **Tester feedback**. Mark notes seen or done.
- **Update the app:** push to GitHub. Netlify and Render redeploy by themselves, and open browsers show "A new version of Kontaa is ready".
- **Reset the demo data:** from your computer, using the Atlas connection string:
  ```powershell
  $env:MONGODB_URI="mongodb+srv://..."; $env:DEMO_PASSWORD="kontaa demo 2026"; npm run seed:demo --workspace server -- --reset
  ```
  Feedback is kept.
- **Emails** (verification, password reset) aren't sent in a test build. Their links appear in the Render logs (**Logs** tab) if a tester gets stuck.
- **AI costs:** the test build caps each workspace at 30 AI questions and 15 receipt scans a month (`PLAN_LIMITS` in `render.yaml`). To switch AI off, set `AI_PROVIDER=none` in Render.
- **When testing is over:** set `APP_STAGE=live` and configure SMTP for a launch. See [deployment.md](deployment.md). Or delete the Render service and Atlas cluster.

## What the test build is not

- **Not for real financial records.** Use made-up details. The banner says so on every screen.
- **Payments are switched off.** No Paystack or Flutterwave keys are set.
- **Free plans have limits:** the server sleeps, Atlas M0 has 512 MB of storage, and there are no automatic backups.
