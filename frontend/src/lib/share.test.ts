import { describe, expect, it } from "vitest";
import { fotoParam, photoLink } from "./share";

describe("photo links", () => {
  it("builds a link to a photo of the current timeline", () => {
    const loc = { origin: "https://reise.example", pathname: "/t/abc" };
    expect(photoLink("9bf6e3f3-ac31", loc)).toBe("https://reise.example/t/abc?foto=9bf6e3f3-ac31");
  });

  it("reads the photo from a link", () => {
    expect(fotoParam("?foto=9bf6e3f3-ac31")).toBe("9bf6e3f3-ac31");
    expect(fotoParam("?x=1&foto=a%20b")).toBe("a b");
    expect(fotoParam("")).toBeNull();
    expect(fotoParam("?foto=")).toBeNull();
  });
});
