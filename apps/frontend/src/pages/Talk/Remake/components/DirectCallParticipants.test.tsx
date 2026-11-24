import { render, screen, within } from "@testing-library/react"
import DirectCallParticipants from "./DirectCallParticipants"

const props = {
    myName: "Саша",
    valueSound: 100,
    setValueSound: () => {},
    avatarByUsername: {},
    stageReady: true
}

it("does not leave stale participants when switching from self to a peer", () => {
    const { rerender } = render(<DirectCallParticipants {...props} names={["Саша", "Саша"]} />)
    for (const peer of ["Маша", "Саша", "Даня", "Саша", "Маша"]) {
        rerender(<DirectCallParticipants {...props} names={[peer, "Саша"]} />)
        const stage = screen.getByRole("list", { name: "Участники звонка" })
        const participants = within(stage).getAllByRole("listitem")
        expect(participants).toHaveLength(peer === "Саша" ? 1 : 2)
        expect(within(stage).getAllByText("Саша", { exact: true })).toHaveLength(1)
        expect(within(stage).getAllByText("Вы", { exact: true })).toHaveLength(1)
        expect(participants[0]).toHaveTextContent(peer)
    }
})

it("normalizes repeated and empty names without duplicating self", () => {
    render(
        <DirectCallParticipants {...props} myName=" Саша " names={[null, " Маша ", "Маша", "", undefined, "Саша"]} />
    )
    const stage = screen.getByRole("list", { name: "Участники звонка" })
    expect(within(stage).getAllByRole("listitem")).toHaveLength(2)
    expect(within(stage).getAllByText("Маша", { exact: true })).toHaveLength(1)
    expect(within(stage).getAllByText("Саша", { exact: true })).toHaveLength(1)
})
