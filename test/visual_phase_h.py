"""Aceite visual da Central de Inteligência com Supabase simulado."""

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
    browser_errors: list[str] = []
    internal_profile = "10000000-0000-4000-8000-000000000001"
    customer_profile = "10000000-0000-4000-8000-000000000002"
    sales_skill = "20000000-0000-4000-8000-000000000001"
    internal_collection = "30000000-0000-4000-8000-000000000001"
    external_collection = "30000000-0000-4000-8000-000000000002"

    def fulfill(route, payload, status=200):
        route.fulfill(status=status, content_type="application/json", body=json.dumps(payload))

    def mock(route):
        request = route.request
        parsed = urlparse(request.url)
        path = parsed.path
        if parsed.netloc == ORIGIN_NETLOC and path == "/api/config":
            return fulfill(route, {
                "supabaseUrl": "https://fase-h.supabase.co",
                "supabasePublishableKey": "sb_publishable_visual_fase_h",
                "publicOrigin": ORIGIN,
            })
        if parsed.netloc in {"fonts.googleapis.com", "fonts.gstatic.com"}:
            return route.fulfill(status=200, content_type="text/css", body="")
        if parsed.netloc != "fase-h.supabase.co":
            return route.continue_()
        if path == "/auth/v1/token":
            return fulfill(route, {
                "access_token": "fase-h-access", "refresh_token": "fase-h-refresh",
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
        tables = {
            "/rest/v1/assistant_templates": [
                {"id": "t1", "audience": "internal", "name": "Assistente interno"},
                {"id": "t2", "audience": "customer", "name": "Assistente de atendimento"},
            ],
            "/rest/v1/assistant_profiles": [
                {"id": internal_profile, "audience": "internal", "display_name": "Assistente da equipe", "tone": "claro e objetivo", "active": True, "brand_config": {}, "process_config": {}},
                {"id": customer_profile, "audience": "customer", "display_name": "Assistente Major", "tone": "cordial e consultivo", "active": True, "brand_config": {"brandName": "Major"}, "process_config": {}},
            ],
            "/rest/v1/skill_definitions": [
                {"id": sales_skill, "owner_type": "platform", "slug": "vendas", "name": "Vendas consultivas", "description": "Conduz descoberta e próximos passos.", "audience": "customer", "status": "published", "current_version": 2, "spec": {"activation": {"keywords": ["preço", "contratar"]}}},
                {"id": "20000000-0000-4000-8000-000000000002", "owner_type": "platform", "slug": "agenda", "name": "Agenda", "description": "Consulta e agenda com confirmação.", "audience": "both", "status": "published", "current_version": 1, "spec": {"activation": {"keywords": ["reunião"]}}},
            ],
            "/rest/v1/skill_versions": [],
            "/rest/v1/assistant_profile_skills": [
                {"organization_id": ORG_ID, "profile_id": customer_profile, "skill_id": sales_skill, "enabled": True, "priority": 10, "configuration": {}},
            ],
            "/rest/v1/knowledge_collections": [
                {"id": internal_collection, "organization_id": ORG_ID, "name": "Conhecimento interno", "audience": "internal", "scope_type": "organization", "status": "active"},
                {"id": external_collection, "organization_id": ORG_ID, "name": "Catálogo publicado", "audience": "external", "scope_type": "organization", "status": "active"},
            ],
            "/rest/v1/knowledge_document_collections": [],
            "/rest/v1/organization_campaigns": [{"id": "c1", "organization_id": ORG_ID, "assistant_profile_id": customer_profile, "name": "Campanha Agosto", "status": "active", "objective": "Agendar diagnóstico", "offer": "Diagnóstico inicial", "audience_description": "Empresas locais", "desired_outcome": "Reunião", "is_default": True, "configuration": {}, "updated_at": "2026-08-23T12:00:00Z"}],
            "/rest/v1/campaign_sources": [{"id": "s1", "campaign_id": "c1", "source_type": "keyword", "source_value": "quero contratar", "priority": 10, "active": True}],
            "/rest/v1/campaign_skills": [{"campaign_id": "c1", "skill_id": sales_skill, "priority": 10}],
            "/rest/v1/campaign_knowledge_collections": [{"campaign_id": "c1", "collection_id": external_collection}],
            "/rest/v1/intelligence_simulations": [],
            "/rest/v1/intelligence_audit_log": [{"id": "a1", "entity_type": "campaign", "entity_id": "c1", "action": "update", "version": None, "metadata": {"name": "Campanha Agosto"}, "created_at": "2026-08-23T12:00:00Z"}],
            "/rest/v1/knowledge_documents": [{"id": "d1", "organization_id": ORG_ID, "scope_type": "organization", "scope_user_id": None, "path": "empresa/identidade.md", "title": "Identidade da Major", "content_markdown": "# Major\n\nClareza e execução.", "status": "active", "audience": "internal", "published_at": None, "version": 2, "created_at": "2026-08-20T12:00:00Z", "updated_at": "2026-08-23T12:00:00Z"}],
        }
        if path == "/rest/v1/rpc/intelligence_context_preview":
            return fulfill(route, {
                "schemaVersion": "fase-h-1", "audiencia": "customer",
                "assistente": {"id": customer_profile, "nome": "Assistente Major"},
                "campanha": {"id": "c1", "nome": "Campanha Agosto"},
                "skillAtivo": {"id": sales_skill, "nome": "Vendas consultivas", "versao": 2},
                "skillsPermitidos": [{"id": sales_skill, "nome": "Vendas consultivas", "versao": 2}],
                "colecoesPermitidas": [{"id": external_collection, "nome": "Catálogo publicado"}],
            })
        if path in tables:
            return fulfill(route, tables[path])
        return fulfill(route, [])

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, executable_path=CHROME)
        context = browser.new_context(viewport={"width": 1440, "height": 940})
        context.route("**/*", mock)
        page = context.new_page()
        page.on("console", lambda message: browser_errors.append(message.text) if message.type == "error" else None)
        page.on("pageerror", lambda error: browser_errors.append(str(error)))
        page.goto(f"{ORIGIN}/app/conhecimento")
        page.wait_for_load_state("networkidle")
        page.get_by_label("E-mail").fill("junior@major.com")
        page.get_by_label("Senha").fill("senha-segura")
        page.get_by_role("button", name="Entrar", exact=True).click()
        expect(page.get_by_role("heading", name="Central de Inteligência")).to_be_visible(timeout=10000)
        expect(page.get_by_text("Identidade da Major", exact=True)).to_be_visible()
        page.get_by_role("button", name="Assistentes", exact=True).click()
        expect(page.locator('input[value="Assistente Major"]')).to_be_visible()
        page.get_by_role("button", name="Skills", exact=True).click()
        expect(page.get_by_text("Vendas consultivas", exact=True)).to_be_visible()
        page.get_by_role("button", name="Campanhas", exact=True).click()
        expect(page.get_by_text("Campanha Agosto", exact=True)).to_be_visible()
        page.get_by_role("button", name="Simulador", exact=True).click()
        page.get_by_placeholder("Olá, vi o anúncio e quero saber o valor").fill("Quero contratar e saber o preço")
        page.get_by_role("button", name="Resolver contexto").click()
        expect(page.locator("strong", has_text="Conhecimento").locator("..")).to_contain_text("1")
        page.screenshot(path=str(ARTIFACTS / "fase-h-inteligencia-desktop.png"), full_page=True)

        storage = context.storage_state()
        mobile = browser.new_context(viewport={"width": 390, "height": 844}, storage_state=storage)
        mobile.route("**/*", mock)
        mobile_page = mobile.new_page()
        mobile_page.on("console", lambda message: browser_errors.append(message.text) if message.type == "error" else None)
        mobile_page.on("pageerror", lambda error: browser_errors.append(str(error)))
        mobile_page.goto(f"{ORIGIN}/app/conhecimento")
        mobile_page.wait_for_load_state("networkidle")
        expect(mobile_page.get_by_role("heading", name="Central de Inteligência")).to_be_visible()
        mobile_page.screenshot(path=str(ARTIFACTS / "fase-h-inteligencia-mobile.png"), full_page=True)
        assert mobile_page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth"), "a Central vazou horizontalmente no celular"
        assert not browser_errors, f"erros no navegador: {browser_errors}"
        mobile.close()
        context.close()
        browser.close()


if __name__ == "__main__":
    run()
