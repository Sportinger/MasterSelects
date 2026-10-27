// Stable selectors of the Help rows and pages of the phone Settings sheet.
export const PHONE_HELP_TEST_IDS = {
  install: 'phone-settings-install',
  /** data-state is installed | prompt | steps; data-platform is ios | android | other. */
  installPage: 'phone-settings-install-page',
  installState: 'phone-settings-install-state',
  installButton: 'phone-settings-install-button',
  installSteps: 'phone-settings-install-steps',
  legal: 'phone-settings-legal',
  legalPage: 'phone-settings-legal-page',
  /** One per legal page; data-page. */
  legalRow: 'phone-settings-legal-row',
  devChat: 'phone-settings-dev-chat',
  /** data-unread is the number of unread developer replies. */
  devChatUnread: 'phone-settings-dev-chat-unread',
  welcomeAgain: 'phone-settings-welcome-again',
  status: 'phone-settings-help-status',
} as const;
