"""proxpresence_core_schema

Revision ID: b005bd6df169
Revises: 
Create Date: 2026-09-04 14:00:16.257926

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.engine.reflection import Inspector

# revision identifiers, used by Alembic.
revision: str = 'b005bd6df169'
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = Inspector.from_engine(bind)
    existing_tables = inspector.get_table_names()

    # 1. students canonical table
    if 'students' not in existing_tables:
        op.create_table(
            'students',
            sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column('roll_no', sa.String(50), unique=True, nullable=False, index=True),
            sa.Column('section', sa.String(50), nullable=False, index=True),
            sa.Column('name', sa.String(100), nullable=False),
            sa.Column('device_hash', sa.String(128), nullable=True),
        )

    # 2. sessions canonical table
    if 'sessions' not in existing_tables:
        op.create_table(
            'sessions',
            sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column('faculty_id', sa.Integer(), nullable=False, index=True),
            sa.Column('room_id', sa.Integer(), nullable=False, index=True),
            sa.Column('section', sa.String(50), nullable=False, index=True),
            sa.Column('starts_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.Column('locks_at', sa.DateTime(), nullable=True),
            sa.Column('status', sa.String(20), nullable=False, server_default='OPEN'),
        )

    # 3. device_bindings (30-min lock per session)
    if 'device_bindings' not in existing_tables:
        op.create_table(
            'device_bindings',
            sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column('device_hash', sa.String(128), nullable=False, index=True),
            sa.Column('student_id', sa.Integer(), nullable=False, index=True),
            sa.Column('bound_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.Column('expires_at', sa.DateTime(), nullable=True),
        )

    # 4. rotating_codes
    if 'rotating_codes' not in existing_tables:
        op.create_table(
            'rotating_codes',
            sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column('session_id', sa.Integer(), nullable=False, index=True),
            sa.Column('code_hash', sa.String(64), nullable=False),
            sa.Column('generated_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.Column('valid_until', sa.DateTime(), nullable=False),
        )

    # 5. sheets_sync_dlq
    if 'sheets_sync_dlq' not in existing_tables:
        op.create_table(
            'sheets_sync_dlq',
            sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column('session_id', sa.Integer(), nullable=False, index=True),
            sa.Column('payload', sa.Text(), nullable=False),
            sa.Column('retry_count', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('error_message', sa.Text(), nullable=True),
            sa.Column('last_attempted_at', sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.Column('status', sa.String(50), nullable=False, server_default='PENDING'),
        )

    # 6. Add ProxPresence columns to qr_attendance_records if table exists
    if 'qr_attendance_records' in existing_tables:
        cols = [c['name'] for c in inspector.get_columns('qr_attendance_records')]
        if 'method' not in cols:
            op.add_column('qr_attendance_records', sa.Column('method', sa.String(20), nullable=True, server_default='ble'))
        if 'rssi' not in cols:
            op.add_column('qr_attendance_records', sa.Column('rssi', sa.Integer(), nullable=True))
        if 'geo_accuracy_m' not in cols:
            op.add_column('qr_attendance_records', sa.Column('geo_accuracy_m', sa.Float(), nullable=True))
        if 'marked_at' not in cols:
            op.add_column('qr_attendance_records', sa.Column('marked_at', sa.DateTime(), nullable=True, server_default=sa.func.now()))

    # 7. Add ProxPresence columns to qr_attendance_audit_reviews if table exists
    if 'qr_attendance_audit_reviews' in existing_tables:
        cols = [c['name'] for c in inspector.get_columns('qr_attendance_audit_reviews')]
        if 'record_id' not in cols:
            op.add_column('qr_attendance_audit_reviews', sa.Column('record_id', sa.Integer(), nullable=True))
        if 'flag' not in cols:
            op.add_column('qr_attendance_audit_reviews', sa.Column('flag', sa.String(50), nullable=True))
        if 'resolved_by' not in cols:
            op.add_column('qr_attendance_audit_reviews', sa.Column('resolved_by', sa.String(100), nullable=True))
        if 'resolved_at' not in cols:
            op.add_column('qr_attendance_audit_reviews', sa.Column('resolved_at', sa.DateTime(), nullable=True))

    # 8. Add ProxPresence columns to qr_attendance_sessions if table exists
    if 'qr_attendance_sessions' in existing_tables:
        cols = [c['name'] for c in inspector.get_columns('qr_attendance_sessions')]
        if 'faculty_id' not in cols:
            op.add_column('qr_attendance_sessions', sa.Column('faculty_id', sa.Integer(), nullable=True))
        if 'room_id' not in cols:
            op.add_column('qr_attendance_sessions', sa.Column('room_id', sa.Integer(), nullable=True))
        if 'starts_at' not in cols:
            op.add_column('qr_attendance_sessions', sa.Column('starts_at', sa.DateTime(), nullable=True, server_default=sa.func.now()))
        if 'locks_at' not in cols:
            op.add_column('qr_attendance_sessions', sa.Column('locks_at', sa.DateTime(), nullable=True))
        if 'kill_switch_active' not in cols:
            op.add_column('qr_attendance_sessions', sa.Column('kill_switch_active', sa.Boolean(), nullable=True, server_default=sa.text('0')))

    # 9. Add device_hash to qr_students if table exists
    if 'qr_students' in existing_tables:
        cols = [c['name'] for c in inspector.get_columns('qr_students')]
        if 'device_hash' not in cols:
            op.add_column('qr_students', sa.Column('device_hash', sa.String(128), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = Inspector.from_engine(bind)
    existing_tables = inspector.get_table_names()

    for tbl in ['sheets_sync_dlq', 'rotating_codes', 'device_bindings', 'sessions', 'students']:
        if tbl in existing_tables:
            op.drop_table(tbl)
