import type { ColorValue } from "react-native";
import Svg, { Path } from "react-native-svg";
import { withUniwind } from "uniwind";

const ThemedPath = withUniwind(Path);

export function T3Wordmark(props: {
  readonly height: number;
  readonly color?: ColorValue;
  readonly colorClassName?: string;
}) {
  // CMDeck placeholder mark (a terminal prompt), not the trademarked T3 wordmark.
  const aspectRatio = 62 / 40;
  return (
    <Svg
      accessibilityLabel="CMDeck"
      height={props.height}
      width={props.height * aspectRatio}
      viewBox="0 0 62 40"
    >
      <ThemedPath
        d="M4 4H11L29 20L11 36H4L22 20Z M32 29H58V36H32Z"
        color={props.color}
        colorClassName={props.colorClassName}
        fill="currentColor"
      />
    </Svg>
  );
}
