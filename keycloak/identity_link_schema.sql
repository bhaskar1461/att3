-- SNIST Keycloak Identity Linking Table Schema
-- Maps external Identity Provider (Google Workspace / Microsoft AD) issuer & subject to canonical SAP ID

CREATE TABLE IF NOT EXISTS snist_identity_links (
    id INT AUTO_INCREMENT PRIMARY KEY,
    sap_id VARCHAR(50) NOT NULL COMMENT 'Canonical institutional identifier (SAP ID / Roll Number)',
    idp_issuer VARCHAR(255) NOT NULL COMMENT 'Identity Provider Issuer URL (e.g., https://accounts.google.com)',
    idp_subject VARCHAR(255) NOT NULL COMMENT 'Unique Identity Provider User Subject ID',
    institutional_email VARCHAR(150) NOT NULL,
    linked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE,
    UNIQUE KEY uk_sap_id (sap_id),
    UNIQUE KEY uk_idp_sub (idp_issuer, idp_subject),
    INDEX idx_institutional_email (institutional_email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
