fn refinement_input(prompt: &str, text: &str, screen_context: &str) -> String {
    let mut input = prompt.trim().to_string();
    let screen_context = tail_chars(screen_context.trim(), 10_000);
    if !screen_context.is_empty() {
        input.push_str(&format!(
            "\n\n[UNTRUSTED SCREEN CONTEXT]\n{screen_context}\n[/UNTRUSTED SCREEN CONTEXT]"
        ));
    }
    input.push_str(&format!(
        "\n\n[TRANSCRIPT TO FORMAT]\n{}\n[/TRANSCRIPT TO FORMAT]",
        text.trim()
    ));
    input
}
