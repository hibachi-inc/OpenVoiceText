import SwiftUI

struct ProUpgradeView: View {
    @State private var upgradeManager = ProUpgradeManager.shared

    #if DIRECT
    @State private var keyInput = ""
    #endif

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
                            Text("pro.activated")
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

                #if DIRECT
                Section("pro.enter_license") {
                    TextField("pro.enter_license.placeholder", text: $keyInput)
                        .textFieldStyle(.roundedBorder)
                        .font(.system(.body, design: .monospaced))

                    HStack {
                        Button(action: {
                            Task { await upgradeManager.activate(key: keyInput) }
                        }) {
                            HStack {
                                if case .loading = upgradeManager.purchaseState {
                                    ProgressView()
                                        .controlSize(.small)
                                    Text("pro.validating")
                                        .font(DS.Font.bodyMedium)
                                } else {
                                    Text("pro.activate")
                                        .font(DS.Font.bodyMedium)
                                }
                            }
                        }
                        .disabled(keyInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                                  || upgradeManager.isLoading)

                        Spacer()

                        Link(destination: ProUpgradeManager.purchaseURL) {
                            Text("pro.buy_license")
                                .font(DS.Font.bodyMedium)
                        }
                    }
                }
                #else
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
                #endif

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

                #if DIRECT
                Section {
                    Button("pro.deactivate", role: .destructive) {
                        Task { await upgradeManager.deactivate() }
                    }
                }
                #endif
            }
        }
        .formStyle(.grouped)
        .navigationTitle(String(localized: "sidebar.pro"))
    }
}
