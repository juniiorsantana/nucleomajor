from pathlib import Path
import unittest


MIGRATION = Path(__file__).parent / "migrations" / "20260822090000_portal_convites_email.sql"


class PortalInvitesMigrationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = MIGRATION.read_text(encoding="utf-8")
        cls.accept_body = cls.sql.split("create or replace function public.accept_organization_invite", 1)[1].split("create or replace function public.list_organization_invites", 1)[0]

    def test_tracks_delivery_without_exposing_token_in_listing(self):
        self.assertIn("add column if not exists revoked_at", self.sql)
        self.assertIn("delivery_status text not null default 'pending'", self.sql)
        self.assertIn("create or replace function public.list_organization_invites", self.sql)
        self.assertNotIn("token_hash", self.sql.split("create or replace function public.list_organization_invites", 1)[1].split("create or replace function public.resend_organization_invite", 1)[0])

    def test_blocks_existing_member_and_never_changes_existing_role_on_accept(self):
        self.assertIn("invite target is already a member of this organization", self.sql)
        self.assertIn("where member.organization_id = convite.organization_id", self.accept_body)
        self.assertIn("insert into public.organization_members", self.accept_body)
        self.assertNotIn("on conflict", self.accept_body.lower())

    def test_supports_expiration_cancellation_resend_and_delivery_state(self):
        self.assertIn("expires_at > now()", self.accept_body)
        self.assertIn("revoked_at is null", self.accept_body)
        self.assertIn("resend_organization_invite", self.sql)
        self.assertIn("revoke_organization_invite", self.sql)
        self.assertIn("mark_organization_invite_delivery", self.sql)
        self.assertIn("revoke all on table public.organization_invites from anon, authenticated", self.sql)


if __name__ == "__main__":
    unittest.main()
