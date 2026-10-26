const test = require("node:test");
const assert = require("node:assert/strict");
const { isOfflineError } = require("../src/main/features/offline");

test("une coupure reseau est reconnue", () => {
  assert.equal(isOfflineError(-106), true); // ERR_INTERNET_DISCONNECTED
  assert.equal(isOfflineError(-105), true); // ERR_NAME_NOT_RESOLVED
});

test("une navigation annulee n'est pas une coupure", () => {
  assert.equal(isOfflineError(-3), false); // ERR_ABORTED
  assert.equal(isOfflineError(0), false);
});
