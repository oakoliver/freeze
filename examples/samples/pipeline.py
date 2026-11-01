from dataclasses import dataclass
from pathlib import Path


@dataclass
class Report:
    name: str
    lines: int
    blank: int


def scan(root: Path, suffix: str = ".py") -> list[Report]:
    """Count lines and blank lines in every file under root."""
    reports = []
    for path in sorted(root.rglob(f"*{suffix}")):
        text = path.read_text(encoding="utf-8")
        lines = text.splitlines()
        blank = sum(1 for line in lines if not line.strip())
        reports.append(Report(path.name, len(lines), blank))
    return reports


if __name__ == "__main__":
    for r in scan(Path(".")):
        print(f"{r.name:<24} {r.lines:>5} lines, {r.blank:>4} blank")
