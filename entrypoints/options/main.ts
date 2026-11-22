import { mountSettingsForm } from "@/content/settings-form.ts";

void mountSettingsForm(document.getElementById("form") as HTMLFormElement, { downloads: true });
