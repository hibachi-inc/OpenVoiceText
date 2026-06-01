import SwiftUI

struct ProUpgradeView: View {
    @State private var upgradeManager = ProUpgradeManager.shared

    var body: some View {
        Form {
            Section {
                HStack(spacing: DS.Spacing.lg) {
                    Image(systemName: "sparkles")
                        .font(.system(size: 32))
                        .foregroundStyle(DS.Colors.accent)

                    VStack(alignment: .leading, spacing: DS.Spacing.xs) {
                        Text("pro.title")
                            .font(DS.Font.title)
                        if upgradeManager.isPro {
                            Text("pro.unlocked")
                                .font(DS.Font.caption)
                                .foregroundStyle(DS.Colors.success)
                        } else {
                            Text("pro.upgrade_prompt")
                                .font(DS.Font.caption)
                                .foregroundStyle(DS.Colors.secondary)
                        }
                    }
                }
                .padding(.vertical, DS.Spacing.sm)
            }

            if !upgradeManager.isPro {
                Section("pro.features") {
                    Label("pro.ai_refinement", systemImage: "sparkles")
                    Label("pro.context_aware", systemImage: "app.dashed")
                    Label("pro.multi_lang", systemImage: "globe")
                    Label("pro.per_lang_shortcuts", systemImage: "keyboard")
                }

                Section {
                    Button(action: { Task { await upgradeManager.purchase() } }) {
                        HStack {
                            Spacer()
                            if let product = upgradeManager.product {
                                Text("pro.upgrade \(product.displayPrice)")
                                    .font(DS.Font.bodyMedium)
                            } else {
                                Text("pro.loading")
                                    .font(DS.Font.bodyMedium)
                            }
                            Spacer()
                        }
                    }
                    .disabled(upgradeManager.product == nil)

                    Button("pro.restore") {
                        Task { await upgradeManager.restorePurchases() }
                    }
                }

                if case .failed(let message) = upgradeManager.purchaseState {
                    Section {
                        Text(message)
                            .font(DS.Font.caption)
                            .foregroundStyle(DS.Colors.error)
                    }
                }
            } else {
                Section {
                    Label("pro.ai_refinement_active", systemImage: "checkmark.circle.fill")
                        .foregroundStyle(DS.Colors.success)
                    Label("pro.translation_active", systemImage: "checkmark.circle.fill")
                        .foregroundStyle(DS.Colors.success)
                }
            }
        }
        .formStyle(.grouped)
        .navigationTitle(String(localized: "sidebar.pro"))
    }
}
