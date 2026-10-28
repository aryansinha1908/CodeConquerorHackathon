// Notification reading (the centre and the bell) against a real MongoDB; see fixtures.js for how to
// run it. Notifications are made with send(), as the services make them.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { Notification } from "../../src/models/index.js";
import {
  listNotifications,
  markAllRead,
  markRead,
  send,
  unreadCount,
} from "../../src/services/notifyService.js";
import { NOW, failure, plus, skip, useTestDatabase } from "./fixtures.js";

let f; // fixtures, rebuilt for every test

function assertError(err, status, code) {
  assert.equal(err.status, status, err.message);
  assert.equal(err.code, code);
}

// Three for the student, oldest first, a minute apart; one for student2.
async function inbox() {
  const badges = [
    "3D Printing Basics",
    "Laser Cutter Operation",
    "GPU Usage Policy",
  ];
  for (const [i, badgeName] of badges.entries()) {
    const [note] = await send([f.student._id], "badge.granted", { badgeName });
    await Notification.updateOne(
      { _id: note._id },
      { createdAt: plus(NOW, i) },
      { timestamps: false },
    );
  }
  await send([f.student2._id], "badge.granted", { badgeName: "Other" });
}

describe("notification reading", { skip }, () => {
  useTestDatabase((fixtures) => {
    f = fixtures;
  });

  describe("listNotifications", () => {
    test("the user's own, newest first, with the unread count", async () => {
      await inbox();
      const { items, meta } = await listNotifications(f.student._id);
      assert.deepEqual(
        items.map((n) => n.body),
        [
          "You now hold GPU Usage Policy.",
          "You now hold Laser Cutter Operation.",
          "You now hold 3D Printing Basics.",
        ],
      );
      assert.deepEqual(meta, { page: 1, limit: 20, total: 3, unread: 3 });
      assert.equal("user" in items[0], false);
      assert.equal(items[0].readAt, null);
      assert.equal(items[0].link, "/badges");
    });

    test("unread=true keeps only unread ones; paging; bad values are 400", async () => {
      await inbox();
      const [newest] = (await listNotifications(f.student._id)).items;
      await markRead(f.student._id, newest._id);

      const unread = await listNotifications(f.student._id, { unread: "true" });
      assert.equal(unread.items.length, 2);
      assert.deepEqual(unread.meta, {
        page: 1,
        limit: 20,
        total: 2,
        unread: 2,
      });
      // An unparsed "false" isn't true.
      assert.equal(
        (await listNotifications(f.student._id, { unread: "false" })).meta
          .total,
        3,
      );

      const page = await listNotifications(f.student._id, {
        page: 2,
        limit: 2,
      });
      assert.deepEqual(
        [page.items.length, page.meta.total, page.meta.unread],
        [1, 3, 2],
      );

      const bad = await failure(
        listNotifications(f.student._id, { unread: "yes", limit: 0 }),
      );
      assertError(bad, 400, "VALIDATION_ERROR");
      assert.deepEqual(
        bad.details.map((d) => d.path),
        ["unread", "limit"],
      );
      assertError(
        await failure(listNotifications("demo-user-id-001")),
        404,
        "NOT_FOUND",
      );
    });
  });

  describe("unreadCount", () => {
    test("counts the user's unread notifications only", async () => {
      await inbox();
      assert.deepEqual(await unreadCount(f.student._id), { count: 3 });
      assert.deepEqual(await unreadCount(String(f.student2._id)), { count: 1 });
      await markAllRead(f.student._id);
      assert.deepEqual(await unreadCount(f.student._id), { count: 0 });
      // No user lookup on the polled path: an unknown id just has none; a malformed one is 404.
      assert.deepEqual(await unreadCount(new mongoose.Types.ObjectId()), {
        count: 0,
      });
      assertError(await failure(unreadCount({ $ne: null })), 404, "NOT_FOUND");
    });
  });

  describe("markRead and markAllRead", () => {
    test("marking read keeps the first readAt; someone else's is 404 and untouched", async () => {
      await inbox();
      const [note] = (await listNotifications(f.student._id)).items;
      const read = await markRead(f.student._id, note._id, { now: NOW });
      assert.equal(read.readAt.toISOString(), NOW.toISOString());
      const again = await markRead(f.student._id, note._id, {
        now: plus(NOW, 5),
      });
      assert.equal(again.readAt.toISOString(), NOW.toISOString());

      const [theirs] = (await listNotifications(f.student2._id)).items;
      assertError(
        await failure(markRead(f.student._id, theirs._id)),
        404,
        "NOT_FOUND",
      );
      assert.equal(
        (await Notification.findById(theirs._id).lean()).readAt,
        null,
      );
      for (const id of ["nope", new mongoose.Types.ObjectId()]) {
        assertError(
          await failure(markRead(f.student._id, id)),
          404,
          "NOT_FOUND",
        );
      }
    });

    test("read-all marks only the user's unread ones and says how many", async () => {
      await inbox();
      const [newest] = (await listNotifications(f.student._id)).items;
      await markRead(f.student._id, newest._id, { now: NOW });

      assert.deepEqual(
        await markAllRead(f.student._id, { now: plus(NOW, 10) }),
        { updated: 2 },
      );
      assert.deepEqual(await markAllRead(f.student._id), { updated: 0 });
      // The one read earlier keeps its time.
      const first = await Notification.findById(newest._id).lean();
      assert.equal(first.readAt.toISOString(), NOW.toISOString());
      assert.deepEqual(await unreadCount(f.student2._id), { count: 1 });
    });
  });
});
