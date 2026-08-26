import { ImageResponse } from "next/og";

// iOS home-screen icon. Mirrors `icon.svg` (the 💩 favicon) but on the app's
// indigo background, since iOS composites the icon onto an opaque tile.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#23204a",
          fontSize: 120,
          lineHeight: 1,
        }}
      >
        💩
      </div>
    ),
    size,
  );
}
