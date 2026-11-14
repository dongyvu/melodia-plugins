import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

root = Path(__file__).resolve().parent


def mix(source, light, dark, light_amount, dark_amount):
    return {
        "mix": [source, {"light": light, "dark": dark}],
        "amount": {"light": light_amount, "dark": dark_amount},
    }


cover = {"adjust": "cover.base", "saturation": 2.0}


def lyric_color(light, dark, *, alpha=255, light_amount=0.89):
    dark_amount = 0.87

    def endpoint(gray, amount):
        # Solve for the tint endpoint's alpha when mixing with an opaque cover.
        tint_alpha = round(255 + (alpha - 255) / amount)
        return f"#{tint_alpha:02X}{gray[1:]}"

    return {
        "adjust": mix(
            {"adjust": "cover.base", "saturation": 4.0},
            endpoint(light, light_amount), endpoint(dark, dark_amount),
            light_amount, dark_amount,
        ),
        "saturation": {"light": 4.0, "dark": 2.5},
    }


sung = lyric_color("#5D5D5D", "#E5E5E5", light_amount=0.90)
harmony = lyric_color("#595959", "#E5E5E5", light_amount=0.90)
unsung = lyric_color("#4D4D4D", "#DCDCDC", alpha=0x73)
harmony_unsung = lyric_color("#494949", "#DCDCDC", alpha=0x38)

for file in ("ui/player.json", "ui/player-wide.json", "ui/lyrics.json"):
    path = root / file
    data = json.loads(path.read_text(encoding="utf-8"))
    data["frame"]["canvasColors"] = {"coverBase": "cover.base"}
    if file == "ui/lyrics.json":
        data["frame"].update(
            sungColor=sung,
            harmonySungColor=harmony,
            unsungColor=unsung,
            harmonyUnsungColor=harmony_unsung,
            translationColor=unsung,
            romanizationColor=unsung,
        )
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

path = root / "ui/mini.json"
data = json.loads(path.read_text(encoding="utf-8"))
top = data["frame"]["background"]["gradient"][0]
top["mix"][0] = mix(cover, "#FFFFFF", "#B7B7B7", 0.86, 0.60)
# Restore some color after blending the light gradient with white.
bottom_tint = mix({"adjust": "cover.base", "saturation": 2.7}, "#FFFFFF", "#B7B7B7", 0.90, 0.47)
bottom = mix(bottom_tint, "#FFFFFF", "#000000", 0.0, 0.47)
data["frame"]["background"]["gradient"][1] = {
    "adjust": bottom,
    "hue": {"light": -10, "dark": 0},
    "saturation": {"light": 1.55, "dark": 1.0},
}
path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

with ZipFile(root / "fluid-player.melodiaplugin", "w", ZIP_DEFLATED) as package:
    for name in ("plugin.json", "ui/player.json", "ui/player-wide.json", "ui/lyrics.json", "ui/mini.json", "background/fluid.js"):
        package.write(root / name, name)
