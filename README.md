# Tea Thermal Monitor

Android app showing live thermal profiles for tea withering and fermentation,
with vibrating alerts when a run starts or finishes and a fallback to the last
recorded profile when nothing is running.

Runs entirely on generated sample data. Section 5 of the design document
explains how the switch to the factory feed works.

## Running it

    npm install
    npx expo start

Scan the QR code with Expo Go on an Android phone. Both devices must be on the
same network.

**Use a real phone, not an emulator.** Notifications and vibration do not fire
on emulators, so the alerts will silently do nothing there.

## What to expect

A run starts within about ten seconds of launch and takes six to eight minutes
of real time, because simulated time is compressed (`SPEED` in
`src/data/mockDataSource.ts`). You should see, in order:

1. A "started" notification with the phone buzzing twice.
2. The profile plot filling in, amber, with a moving head marker.
3. An occasional gap, which is deliberate, so the stale state is testable.
4. A "finished" notification carrying the duration, final temperature and peak.
5. The screen turning cool grey and showing the run you just watched as history.

Kill the app and reopen it: the last recorded profile is still there, read from
SQLite rather than regenerated.

## Building an APK

    npm install -g eas-cli
    eas login
    eas build -p android --profile preview

## Layout

    app/
      _layout.tsx              root, boots the store
      (tabs)/
        withering.tsx          both use ProcessScreen
        fermentation.tsx
        alerts.tsx
        settings.tsx
    src/
      data/
        types.ts               domain types and the DataSource interface
        mockDataSource.ts      sample curves
        thingsboardDataSource.ts   stub; the whole migration lives here
        index.ts               picks the active source
      db/database.ts           SQLite: profiles, points, alerts
      alerts/
        engine.ts              run detection, thresholds, alert text
        notifications.ts       channel setup, permissions, vibration
      components/
        ProcessScreen.tsx
        ProfileChart.tsx
      store.ts                 wires source to database to alerts
      theme.ts

## Two things worth knowing before changing the code

**Android takes the vibration pattern from the notification channel**, not from
the individual notification, and drops any notification posted without a
channel with no error at all. `setupNotifications()` creates it at startup;
do not post before that runs.

**Nothing above `DataSource` knows where readings come from.** Implementing
`ThingsBoardDataSource` and changing one line in `src/data/index.ts` is the
entire migration to live data. If you find yourself editing a screen to make
the factory feed work, something has gone wrong.
