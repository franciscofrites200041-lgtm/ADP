import { describe, expect, it } from "vitest";

import {
  type AddressPolicyInput,
  checkAddresses,
  forbiddenReason,
} from "./network-policy.ts";

describe("forbiddenReason", () => {
  // Every case below is a destination a user base URL must never reach.
  // The public ones are the control group: a guard that blocks everything is
  // useless.
  it.each([
    ["8.8.8.8", null],
    ["1.1.1.1", null],
    ["203.0.113.10", null],
    ["127.0.0.1", "loopback"],
    ["127.255.255.254", "loopback"],
    ["10.0.0.5", "private"],
    ["172.16.0.1", "private"],
    ["172.31.255.255", "private"],
    ["192.168.1.1", "private"],
    ["169.254.169.254", "metadata"],
    ["169.254.170.2", "metadata"],
    ["169.254.1.1", "link_local"],
    ["100.64.0.1", "carrier_grade_nat"],
    ["100.127.255.255", "carrier_grade_nat"],
    ["0.0.0.0", "unspecified"],
    ["224.0.0.1", "multicast"],
    ["239.255.255.250", "multicast"],
    ["240.0.0.1", "reserved"],
    ["198.18.0.1", "reserved"],
    ["192.0.0.8", "reserved"],
  ] as const)("classifies %s as %s", (address, reason) => {
    expect(forbiddenReason(address)).toBe(reason);
  });

  it("does not treat neighbouring public ranges as private", () => {
    // 172.32 is outside 172.16/12, and 100.128 outside the carrier-grade block.
    expect(forbiddenReason("172.32.0.1")).toBeNull();
    expect(forbiddenReason("100.128.0.1")).toBeNull();
  });

  it.each([
    ["::1", "loopback"],
    ["::", "unspecified"],
    ["fd00::1", "private"],
    ["fcff::1", "private"],
    ["fe80::1", "link_local"],
    ["ff02::1", "multicast"],
    ["::ffff:127.0.0.1", "loopback"],
    ["::ffff:10.0.0.1", "private"],
    ["::ffff:8.8.8.8", null],
    // IPv4-compatible: the deprecated ::/96 form, still routed by some stacks.
    ["::127.0.0.1", "loopback"],
    ["::1.2.3.4", null],
    // Outside the 64:ff9b::/96 prefix, so there is no embedded IPv4 to judge.
    ["64:ff9b:0:1::a00:1", null],
    ["64:ff9b::a00:1", "private"],
    ["2001:4860:4860::8888", null],
    ["2606:4700:4700::1111", null],
  ] as const)("classifies %s as %s", (address, reason) => {
    expect(forbiddenReason(address)).toBe(reason);
  });

  it("refuses anything that is not an address", () => {
    expect(forbiddenReason("localhost")).toBe("not_an_ip");
    expect(forbiddenReason("")).toBe("not_an_ip");
    expect(forbiddenReason("8.8.8")).toBe("not_an_ip");
    expect(forbiddenReason("8.8.8.8.8")).toBe("not_an_ip");
    // Octal-looking IPv4 is a classic bypass; it is not a valid address here.
    expect(forbiddenReason("0177.0.0.1")).toBe("not_an_ip");
    expect(forbiddenReason("0x7f.0.0.1")).toBe("not_an_ip");
  });

  it("rejects a name that resolves to any forbidden address", () => {
    // One bad address is enough: both means a rebinding attempt.
    expect(
      checkAddresses({
        host: "llm.example.com",
        resolvedAddresses: ["8.8.8.8", "127.0.0.1"],
      }),
    ).toBe("loopback");
  });
});

describe("checkAddresses", () => {
  it("accepts a name whose every address is public", () => {
    const input: AddressPolicyInput = {
      host: "llm.example.com",
      resolvedAddresses: ["8.8.8.8", "2606:4700:4700::1111"],
    };
    expect(checkAddresses(input)).toBeNull();
  });

  it("checks an address literal without resolving it", () => {
    expect(checkAddresses({ host: "127.0.0.1", resolvedAddresses: [] })).toBe(
      "loopback",
    );
    expect(
      checkAddresses({ host: "8.8.8.8", resolvedAddresses: [] }),
    ).toBeNull();
  });

  it("treats an empty resolution as unresolvable, never as a pass", () => {
    // A name we cannot resolve is not a name we can vouch for; the reason says
    // what actually happened instead of claiming the host is not an address.
    expect(
      checkAddresses({ host: "nope.example", resolvedAddresses: [] }),
    ).toBe("unresolvable");
  });

  it("keeps not_an_ip for a host that is not an IP nor a name", () => {
    expect(forbiddenReason("localhost")).toBe("not_an_ip");
  });

  it("rejects the metadata service reached by name", () => {
    expect(
      checkAddresses({
        host: "metadata.example",
        resolvedAddresses: ["169.254.169.254"],
      }),
    ).toBe("metadata");
  });
});
