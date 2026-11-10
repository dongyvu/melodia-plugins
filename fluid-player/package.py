from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json
root = Path(__file__).resolve().parent
palettes = json.loads((root / "colors/palettes.json").read_text(encoding="utf-8"))
def expression(slot, dark_slot=None):
    def themed(p):
        return {"light": p["light"][slot], "dark": p["dark"][dark_slot or slot]}
    return {"huePalette": "cover.base", "minSaturation": palettes["minSaturation"],
            "neutral": themed(palettes["neutral"]),
            "stops": [{"hue": p["hue"], "color": themed(p)} for p in palettes["stops"]]}
for file in ("ui/player.json", "ui/player-wide.json", "ui/lyrics.json"):
    path = root / file
    data = json.loads(path.read_text(encoding="utf-8"))
    data["frame"]["canvasColors"] = {slot: expression(slot) for slot in ("glow1", "glow2", "glow3")}
    if file == "ui/lyrics.json":
        data["frame"]["sungColor"] = expression("sung")
        data["frame"]["harmonySungColor"] = expression("harmony")
        data["frame"]["translationColor"] = data["frame"]["unsungColor"]
        data["frame"]["romanizationColor"] = data["frame"]["unsungColor"]
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
# Mini player uses the same preset source as the glow, retaining its existing
# vertical gradient, theme mixing amounts, foreground and native controls.
path = root / "ui/mini.json"
data = json.loads(path.read_text(encoding="utf-8"))
for stop, slot in zip(data["frame"]["background"]["gradient"], ("glow3", "glow1")):
    stop["mix"][0] = expression(slot, dark_slot="glow1")
path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
with ZipFile(root / "fluid-player.melodiaplugin", "w", ZIP_DEFLATED) as package:
    for name in ("plugin.json", "ui/player.json", "ui/player-wide.json", "ui/lyrics.json", "ui/mini.json", "background/fluid.js"):
        package.write(root / name, name)
