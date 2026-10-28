import { describe, test } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { ServiceError } from "../../src/lib/serviceError.js";
import {
  isAdmin,
  managesUnit,
  requireAdmin,
  requireUnitManager,
} from "../../src/services/access.js";

const { ObjectId } = mongoose.Types;
const dic = new ObjectId();
const cse = new ObjectId();

const member = { _id: new ObjectId(), roles: ["member"] };
const manager = {
  _id: new ObjectId(),
  roles: ["member", "manager"],
  managedOrgUnits: [dic],
};
const admin = { _id: new ObjectId(), roles: ["admin"] };

const isForbidden = (message) => (err) =>
  err instanceof ServiceError &&
  err.status === 403 &&
  err.code === "FORBIDDEN" &&
  err.message === message;

describe("isAdmin", () => {
  test("only the admin role counts", () => {
    assert.equal(isAdmin(admin), true);
    assert.equal(isAdmin(manager), false);
    assert.equal(isAdmin(member), false);
    assert.equal(isAdmin({}), false);
    assert.equal(isAdmin(null), false);
  });
});

describe("managesUnit", () => {
  test("a manager manages the units in managedOrgUnits and no others", () => {
    assert.equal(managesUnit(manager, dic), true);
    assert.equal(managesUnit(manager, cse), false);
  });

  test("compares ids as strings, for raw ids and populated docs alike", () => {
    assert.equal(managesUnit(manager, String(dic)), true);
    assert.equal(managesUnit(manager, { _id: dic, name: "DIC" }), true);
    const populated = {
      ...manager,
      managedOrgUnits: [{ _id: dic, code: "dic" }],
    };
    assert.equal(managesUnit(populated, new ObjectId(String(dic))), true);
    assert.equal(managesUnit(populated, cse), false);
  });

  test("upper-case hex names the same unit", () => {
    assert.equal(managesUnit(manager, String(dic).toUpperCase()), true);
    assert.equal(managesUnit(manager, String(cse).toUpperCase()), false);
    const upperList = {
      ...manager,
      managedOrgUnits: [String(dic).toUpperCase()],
    };
    assert.equal(managesUnit(upperList, dic), true);
  });

  test("an admin manages every unit", () => {
    assert.equal(managesUnit(admin, dic), true);
    assert.equal(managesUnit(admin, cse), true);
  });

  test("the list alone isn't enough without the manager role", () => {
    assert.equal(
      managesUnit({ ...member, managedOrgUnits: [dic] }, dic),
      false,
    );
  });

  test("members, missing users and missing units get nothing", () => {
    assert.equal(managesUnit(member, dic), false);
    assert.equal(managesUnit(null, dic), false);
    assert.equal(managesUnit(manager, null), false);
    assert.equal(managesUnit(manager, undefined), false);
    assert.equal(
      managesUnit({ roles: ["manager"], managedOrgUnits: [null] }, null),
      false,
    );
  });
});

describe("requireAdmin", () => {
  test("returns the admin", () => {
    assert.equal(requireAdmin(admin), admin);
  });

  test("throws 403 FORBIDDEN for anyone else, with a default or given message", () => {
    assert.throws(
      () => requireAdmin(manager),
      isForbidden("Only an admin can do that."),
    );
    assert.throws(
      () => requireAdmin(null, "Only an admin can add org units."),
      isForbidden("Only an admin can add org units."),
    );
  });
});

describe("requireUnitManager", () => {
  test("returns a manager of the unit, or an admin", () => {
    assert.equal(requireUnitManager(manager, dic), manager);
    assert.equal(requireUnitManager(admin, cse), admin);
  });

  test("throws 403 FORBIDDEN for another unit's manager or a member", () => {
    assert.throws(
      () => requireUnitManager(manager, cse),
      isForbidden("Only this unit's managers can do that."),
    );
    assert.throws(
      () =>
        requireUnitManager(
          member,
          dic,
          "You can only list resources for units you manage.",
        ),
      isForbidden("You can only list resources for units you manage."),
    );
  });
});
