export type LegalDocumentId = "terms" | "privacy" | "aup" | "dmca";

export interface LegalDocumentSection {
  heading: string;
  paragraphs?: string[];
  bullets?: string[];
}

export interface LegalDocument {
  id: LegalDocumentId;
  label: string;
  title: string;
  lastUpdated: string;
  sections: LegalDocumentSection[];
}

export const legalDocuments: LegalDocument[] = [
  {
    id: "terms",
    label: "Terms of Service",
    title: "Terms of Service",
    lastUpdated: "June 13, 2026",
    sections: [
      {
        heading: "Leeku's Secure Vault (leeks.miku.rip)",
        paragraphs: ["By using the Service, you agree to these Terms."],
      },
      {
        heading: "Service Description",
        paragraphs: [
          "Leeku's Secure Vault provides secure file storage and file sharing capabilities.",
        ],
      },
      {
        heading: "Eligibility",
        paragraphs: ["You must be at least 13 years old."],
      },
      {
        heading: "User Accounts",
        paragraphs: ["You are responsible for your account and credentials."],
      },
      {
        heading: "Storage Quotas",
        paragraphs: [
          "Storage quotas are assigned by administrators and may be adjusted at any time.",
        ],
      },
      {
        heading: "Voluntary Donations",
        paragraphs: [
          "Donations are optional and do not grant special privileges, features, or guarantees.",
        ],
      },
      {
        heading: "Acceptable Use",
        paragraphs: [
          "Users may not upload illegal, malicious, harmful, or infringing content.",
        ],
      },
      {
        heading: "File Scanning",
        paragraphs: ["Uploaded files may be scanned for malware and security threats."],
      },
      {
        heading: "Data Retention",
        paragraphs: [
          "Users are responsible for maintaining backups. Files may be removed when necessary.",
        ],
      },
      {
        heading: "Intellectual Property",
        paragraphs: ["Users retain ownership of uploaded content."],
      },
      {
        heading: "Service Availability",
        paragraphs: ["The Service is provided on an AS IS and AS AVAILABLE basis."],
      },
      {
        heading: "Limitation of Liability",
        paragraphs: ["Use of the Service is at your own risk."],
      },
      {
        heading: "Termination",
        paragraphs: [
          "Accounts may be suspended or terminated for violations of these Terms.",
        ],
      },
      {
        heading: "Governing Law",
        paragraphs: ["These Terms are governed by the laws of Quebec and Canada."],
      },
    ],
  },
  {
    id: "privacy",
    label: "Privacy Policy",
    title: "Privacy Policy",
    lastUpdated: "June 13, 2026",
    sections: [
      {
        heading: "Leeku's Secure Vault (leeks.miku.rip)",
      },
      {
        heading: "Information We Collect",
        bullets: ["Account information", "Technical information", "File metadata"],
      },
      {
        heading: "How We Use Information",
        bullets: [
          "Operate the Service",
          "Maintain security",
          "Detect abuse",
          "Improve reliability",
        ],
      },
      {
        heading: "File Scanning",
        paragraphs: ["Files may be scanned automatically for security purposes."],
      },
      {
        heading: "Data Sharing",
        paragraphs: ["We do not sell user information."],
      },
      {
        heading: "Data Retention",
        paragraphs: [
          "Information may be retained as needed for operation, security, and legal compliance.",
        ],
      },
      {
        heading: "Security",
        paragraphs: [
          "We implement reasonable security measures but cannot guarantee absolute security.",
        ],
      },
      {
        heading: "User Rights",
        paragraphs: [
          "Users may request access, correction, or deletion of personal information where applicable.",
        ],
      },
    ],
  },
  {
    id: "aup",
    label: "Acceptable Use Policy",
    title: "Acceptable Use Policy (AUP)",
    lastUpdated: "July 20, 2026",
    sections: [
      {
        heading: "Leeku's Secure Vault (leeks.miku.rip)",
      },
      {
        heading: "Prohibited Content",
        bullets: [
          "Malware",
          "Viruses",
          "Illegal content",
          "Copyright infringement",
          "Harmful or abusive content",
          "Pornography",
          "Zoophilia",
          "Terroristic propaganda",
          "Gore",
          "Doxing"
        ],
      },
      {
        heading: "Prohibited Activities",
        bullets: [
          "Unauthorized access attempts",
          "Spam campaigns",
          "Phishing",
          "Resource abuse",
          "Service disruption",
        ],
      },
      {
        heading: "Enforcement",
        paragraphs: [
          "We reserve the right to remove content, suspend accounts, or report illegal activity.",
        ],
      },
    ],
  },
  {
    id: "dmca",
    label: "Copyright & DMCA Policy",
    title: "Copyright & DMCA Policy",
    lastUpdated: "July 20, 2026",
    sections: [
      {
        heading: "Leeku's Secure Vault (leeks.miku.rip)",
      },
      {
        heading: "Copyright Respect",
        paragraphs: [
          "Users must not upload content that infringes intellectual property rights.",
        ],
      },
      {
        heading: "Copyright Complaints",
        paragraphs: ["Rights holders may submit infringement notices."],
      },
      {
        heading: "Content Removal",
        paragraphs: [
          "We may remove or disable access to allegedly infringing content.",
        ],
      },
      {
        heading: "Repeat Infringers",
        paragraphs: ["Repeat offenders may have their accounts and all related files terminated & deleted."],
      },
      {
        heading: "Counter-Notification",
        paragraphs: ["Users may submit counter-notifications when appropriate."],
      },
    ],
  },
];