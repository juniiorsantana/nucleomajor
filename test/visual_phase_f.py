"""Aceite visual e de navegação do portal React com Supabase simulado."""

import json
import os
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / "test-artifacts"
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
ORG_ID = "338e44ca-36ab-437c-b8ac-aa7c60fee64a"
USER_ID = "33333333-3333-4333-8333-333333333333"
ORIGIN = os.environ.get("VISUAL_TEST_ORIGIN", "http://127.0.0.1:3199")
ORIGIN_NETLOC = urlparse(ORIGIN).netloc


def run() -> None:
    ARTIFACTS.mkdir(exist_ok=True)
    browser_errors = []
    assistant_messages = []
    knowledge = [{
        "id": "11111111-1111-4111-8111-111111111111",
        "organization_id": ORG_ID,
        "scope_type": "organization",
        "scope_user_id": None,
        "path": "empresa/identidade.md",
        "title": "Identidade da Major",
        "content_markdown": "# Major\n\nClareza, contexto e execução.",
        "status": "active",
        "version": 3,
        "created_at": "2026-08-20T12:00:00Z",
        "updated_at": "2026-08-22T20:00:00Z",
    }]

    def fulfill(route, payload, status=200):
        route.fulfill(status=status, content_type="application/json", body=json.dumps(payload))

    def mock(route):
        request = route.request
        parsed = urlparse(request.url)
        path = parsed.path

        if parsed.netloc == ORIGIN_NETLOC and path == "/api/config":
            return fulfill(route, {
                "supabaseUrl": "https://teste.supabase.co",
                "supabasePublishableKey": "sb_publishable_visual_only",
                "publicOrigin": ORIGIN,
            })
        if parsed.netloc == ORIGIN_NETLOC and path == "/api/assistant/threads":
            return fulfill(route, {"threads": []})
        if parsed.netloc == ORIGIN_NETLOC and path == "/api/assistant/messages":
            if request.method == "POST":
                body = request.post_data_json
                assistant_messages.extend([
                    {"id": "m-user", "thread_id": "thread-1", "role": "user", "content": body["content"], "metadata": {}, "created_at": "2026-08-23T01:00:00Z"},
                    {"id": "m-assistant", "thread_id": "thread-1", "role": "assistant", "content": "Sua agenda está livre no período consultado.", "metadata": {}, "created_at": "2026-08-23T01:00:01Z"},
                ])
                result = json.dumps({"threadId": "thread-1", "message": assistant_messages[-1]})
                return route.fulfill(
                    status=200,
                    content_type="text/event-stream",
                    body=f'event: status\ndata: {{"message":"Consultando agenda…"}}\n\nevent: result\ndata: {result}\n\n',
                )
            return fulfill(route, {"messages": assistant_messages})
        if parsed.netloc == ORIGIN_NETLOC and path.startswith("/api/invitations"):
            return fulfill(route, {"invitations": []})
        if parsed.netloc in {"fonts.googleapis.com", "fonts.gstatic.com"}:
            return route.fulfill(status=200, content_type="text/css", body="")
        if parsed.netloc != "teste.supabase.co":
            return route.continue_()

        if path == "/auth/v1/token":
            return fulfill(route, {
                "access_token": "visual-access", "refresh_token": "visual-refresh",
                "expires_in": 3600, "token_type": "bearer",
                "user": {"id": USER_ID, "email": "junior@major.com", "user_metadata": {"full_name": "Juniior Santana"}},
            })
        if path == "/rest/v1/organization_members":
            return fulfill(route, [{
                "organization_id": ORG_ID, "user_id": USER_ID, "role": "owner", "status": "active",
                "responsibility": "Direção", "joined_at": "2026-08-12T00:00:00Z",
                "organization": {"id": ORG_ID, "name": "Major", "slug": "major"},
                "profile": {"id": USER_ID, "full_name": "Juniior Santana", "avatar_path": None},
            }])
        if path == "/rest/v1/organizations":
            return fulfill(route, [{"id": ORG_ID, "name": "Major", "slug": "major"}])
        if path == "/rest/v1/contacts":
            return fulfill(route, [{
                "id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "name": "Lucas LP", "phone": "5566999640274",
                "company": "Major", "job_title": "Comercial", "email": "lucas@major.com", "source": "WhatsApp",
                "owner_label": "Lucas", "contact_tags": [], "created_at": "2026-08-20T00:00:00Z", "updated_at": "2026-08-22T00:00:00Z",
            }])
        if path in {"/rest/v1/deals", "/rest/v1/tasks", "/rest/v1/notes", "/rest/v1/contact_events", "/rest/v1/chatbot_definitions", "/rest/v1/connection_robot_credentials"}:
            return fulfill(route, [])
        if path == "/rest/v1/stages":
            return fulfill(route, [
                {"id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "name": "Novo lead", "position": 0},
                {"id": "cccccccc-cccc-4ccc-8ccc-cccccccccccc", "name": "Fechado", "position": 1},
            ])
        if path == "/rest/v1/tags":
            return fulfill(route, [{"id": "dddddddd-dddd-4ddd-8ddd-dddddddddddd", "name": "Cliente", "color": "#147A52"}])
        if path == "/rest/v1/knowledge_documents":
            return fulfill(route, knowledge)
        if path == "/rest/v1/knowledge_document_versions":
            return fulfill(route, [])
        if path == "/rest/v1/whatsapp_connections":
            return fulfill(route, [{
                "id": "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", "name": "WhatsApp principal",
                "status": "connected", "automation_status": "active", "verified_phone_last4": "8362",
                "updated_at": "2026-08-23T00:00:00Z",
            }])
        if path == "/rest/v1/rpc/calendar_context":
            return fulfill(route, {"members": [], "categories": [], "preferences": {"default_view": "week"}, "phone": None})
        if path == "/rest/v1/rpc/calendar_events_list":
            return fulfill(route, [])
        if path == "/rest/v1/rpc/calendar_notifications_list":
            return fulfill(route, [])
        return fulfill(route, [])

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, executable_path=CHROME)
        context = browser.new_context(viewport={"width": 1440, "height": 940}, device_scale_factor=1)
        context.route("**/*", mock)
        page = context.new_page()
        page.on("console", lambda message: browser_errors.append(message.text) if message.type == "error" else None)
        page.on("pageerror", lambda error: browser_errors.append(str(error)))
        page.goto(f"{ORIGIN}/app/assistente")
        page.wait_for_load_state("networkidle")
        expect(page.get_by_role("heading", name="Entre na sua gestão")).to_be_visible()
        page.get_by_label("E-mail").fill("junior@major.com")
        page.get_by_label("Senha").fill("senha-segura")
        page.get_by_role("button", name="Entrar", exact=True).click()
        expect(page.get_by_role("heading", name="O que precisa avançar agora?")).to_be_visible(timeout=10000)
        page.screenshot(path=str(ARTIFACTS / "fase-f-assistente-desktop.png"), full_page=True)

        page.get_by_placeholder("Peça uma consulta, resumo ou compromisso…").fill("Como está minha agenda?")
        page.get_by_role("button", name="Enviar mensagem").click()
        expect(page.get_by_text("Sua agenda está livre no período consultado.")).to_be_visible()

        page.get_by_role("button", name="Contatos", exact=True).click()
        expect(page.get_by_role("heading", name="Contatos")).to_be_visible()
        expect(page.get_by_text("Lucas LP", exact=True)).to_be_visible()
        page.get_by_role("button", name="Conhecimento", exact=True).click()
        expect(page.get_by_role("heading", name="Núcleo de Conhecimento")).to_be_visible()
        expect(page.get_by_text("Identidade da Major", exact=True)).to_be_visible()
        page.screenshot(path=str(ARTIFACTS / "fase-f-conhecimento-desktop.png"), full_page=True)

        storage = context.storage_state()
        mobile = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=1, storage_state=storage)
        mobile.route("**/*", mock)
        mobile_page = mobile.new_page()
        mobile_page.on("console", lambda message: browser_errors.append(message.text) if message.type == "error" else None)
        mobile_page.on("pageerror", lambda error: browser_errors.append(str(error)))
        mobile_page.goto(f"{ORIGIN}/app/assistente")
        mobile_page.wait_for_load_state("networkidle")
        expect(mobile_page.get_by_role("heading", name="O que precisa avançar agora?")).to_be_visible()
        mobile_page.screenshot(path=str(ARTIFACTS / "fase-f-assistente-mobile.png"), full_page=True)
        assert mobile_page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth"), "vazamento horizontal no celular"
        assert not browser_errors, f"erros no navegador: {browser_errors}"
        mobile.close()
        context.close()
        browser.close()


if __name__ == "__main__":
    run()
