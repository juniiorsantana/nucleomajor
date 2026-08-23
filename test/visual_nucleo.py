"""Aceite visual manual do Núcleo web com Supabase simulado."""

import json
import time
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright, expect


ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / "test-artifacts"
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
ORG_ID = "338e44ca-36ab-437c-b8ac-aa7c60fee64a"
USER_ID = "33333333-3333-4333-8333-333333333333"


def run() -> None:
    ARTIFACTS.mkdir(exist_ok=True)
    documents = [
        {
            "id": "11111111-1111-4111-8111-111111111111",
            "organization_id": ORG_ID,
            "scope_type": "organization",
            "scope_user_id": None,
            "path": "Empresa/identidade.md",
            "title": "Identidade da Major",
            "content_markdown": "# Major\n\nPrincípios e posicionamento.",
            "status": "active",
            "version": 3,
            "updated_at": "2026-08-22T20:00:00Z",
            "created_by": USER_ID,
            "updated_by": USER_ID,
        },
        {
            "id": "22222222-2222-4222-8222-222222222222",
            "organization_id": ORG_ID,
            "scope_type": "team",
            "scope_user_id": None,
            "path": "Atendimento/qualificacao.md",
            "title": "Qualificação de oportunidades",
            "content_markdown": "# Qualificação\n\nPerguntas essenciais.",
            "status": "active",
            "version": 2,
            "updated_at": "2026-08-21T20:00:00Z",
            "created_by": USER_ID,
            "updated_by": USER_ID,
        },
    ]
    errors: list[str] = []

    def json_response(route, payload, status=200):
        route.fulfill(status=status, content_type="application/json", body=json.dumps(payload))

    def mock(route):
        url = route.request.url
        parsed = urlparse(url)
        if parsed.path == "/api/config":
            return json_response(route, {
                "supabaseUrl": "https://project.supabase.co",
                "supabasePublishableKey": "sb_publishable_visual_test",
                "publicOrigin": "http://127.0.0.1:3000",
            })
        if parsed.netloc in {"fonts.googleapis.com", "fonts.gstatic.com"}:
            return route.fulfill(status=200, content_type="text/css", body="")
        if parsed.netloc != "project.supabase.co":
            return route.continue_()
        if parsed.path == "/auth/v1/user":
            return json_response(route, {"id": USER_ID, "email": "junior@major.com"})
        if parsed.path == "/rest/v1/organization_members":
            return json_response(route, [{"organization_id": ORG_ID, "role": "owner", "status": "active"}])
        if parsed.path == "/rest/v1/organizations":
            return json_response(route, [{"id": ORG_ID, "name": "Major", "slug": "major"}])
        if parsed.path == "/rest/v1/knowledge_document_versions":
            return json_response(route, [{"id": "v1", "version": 3, "title": "Identidade da Major", "path": "Empresa/identidade.md", "created_at": "2026-08-22T20:00:00Z"}])
        if parsed.path == "/rest/v1/knowledge_documents":
            if route.request.method == "POST":
                body = route.request.post_data_json
                saved = {
                    **body,
                    "id": "77777777-7777-4777-8777-777777777777",
                    "status": "active",
                    "version": 1,
                    "updated_at": "2026-08-23T00:00:00Z",
                }
                documents.append(saved)
                return json_response(route, [saved], 201)
            return json_response(route, documents)
        return json_response(route, {"message": f"Mock ausente: {parsed.path}"}, 404)

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, executable_path=CHROME)
        context = browser.new_context(viewport={"width": 1440, "height": 940}, device_scale_factor=1)
        context.add_init_script(
            "sessionStorage.setItem('nucleo-major-web-session', JSON.stringify(" +
            json.dumps({
                "access_token": "visual-access",
                "refresh_token": "visual-refresh",
                "expires_at": int(time.time()) + 3600,
            }) + "))"
        )
        context.route("**/*", mock)
        page = context.new_page()
        page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto("http://127.0.0.1:3000/app/nucleo")
        page.wait_for_load_state("networkidle")
        expect(page.get_by_role("heading", name="Núcleo de Conhecimento")).to_be_visible()
        expect(page.get_by_text("Identidade da Major", exact=True)).to_be_visible()
        page.locator(".document-item").first.click()
        expect(page.locator("#document-content")).to_have_value("# Major\n\nPrincípios e posicionamento.")
        page.screenshot(path=str(ARTIFACTS / "nucleo-desktop.png"), full_page=True)

        page.get_by_role("button", name="Meu espaço Referências privadas").click()
        page.get_by_role("button", name="Novo documento").click()
        page.locator("#document-title").fill("Preferências de trabalho")
        page.locator("#document-path").fill("Pessoal/preferencias")
        page.locator("#document-content").fill("# Preferências\n\nBlocos de foco pela manhã.")
        page.get_by_role("button", name="Salvar").click()
        expect(page.get_by_text("Documento salvo e versionado.")).to_be_visible()
        expect(page.get_by_text("Preferências de trabalho", exact=True)).to_be_visible()

        mobile = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=1)
        mobile.add_init_script(
            "sessionStorage.setItem('nucleo-major-web-session', JSON.stringify(" +
            json.dumps({"access_token": "visual-access", "refresh_token": "visual-refresh", "expires_at": int(time.time()) + 3600}) + "))"
        )
        mobile.route("**/*", mock)
        mobile_page = mobile.new_page()
        mobile_page.on("pageerror", lambda error: errors.append(str(error)))
        mobile_page.goto("http://127.0.0.1:3000/app")
        mobile_page.wait_for_load_state("networkidle")
        expect(mobile_page.get_by_role("heading", name="Núcleo de Conhecimento")).to_be_visible()
        expect(mobile_page.get_by_text("Identidade da Major", exact=True)).to_be_visible()
        mobile_page.screenshot(path=str(ARTIFACTS / "nucleo-mobile.png"), full_page=True)
        assert mobile_page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth"), "a página vazou horizontalmente no celular"
        assert not errors, f"erros no navegador: {errors}"
        mobile.close()
        context.close()
        browser.close()


if __name__ == "__main__":
    run()
